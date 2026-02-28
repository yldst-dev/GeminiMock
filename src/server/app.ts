import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { createAccountStore } from "../auth/account-store.js";
import { OAuthService } from "../auth/oauth-service.js";
import { loadEnv, type AppEnv } from "../config/env.js";
import { CodeAssistClient } from "../gemini/code-assist-client.js";
import { ModelCatalogService } from "../gemini/model-catalog-service.js";
import { OpenAIChatService } from "../openai/chat-service.js";
import { toOpenAIModelList } from "../openai/models-response.js";
import { openAIChatCompletionRequestSchema, type OpenAIChatCompletionRequest, type OpenAIChatCompletionResponse } from "../openai/types.js";

export type ChatService = {
  generate(request: OpenAIChatCompletionRequest): Promise<OpenAIChatCompletionResponse>;
  stream?(request: OpenAIChatCompletionRequest): AsyncGenerator<unknown>;
};

export type AppDependencies = {
  env: AppEnv;
  oauthService: OAuthService;
  chatService: ChatService;
  modelCatalogService: ModelCatalogService;
};

export async function createDefaultDependencies(env = loadEnv()): Promise<AppDependencies> {
  const store = createAccountStore(env.accountsPath, env.oauthPath, env.oauthFallbackPath);
  const oauthService = new OAuthService(store);
  const codeAssistClient = new CodeAssistClient(
    env,
    () => oauthService.getAccessToken(),
    {
      onApiError: (error) => oauthService.handleCodeAssistError(error),
      onApiSuccess: () => oauthService.handleCodeAssistSuccess(),
      maxAttempts: () => oauthService.getApiAttemptLimit(),
      getAccountCacheKey: () => oauthService.getActiveAccountId()
    }
  );
  const modelCatalogService = new ModelCatalogService(codeAssistClient);
  const chatService = new OpenAIChatService(env.defaultModel, codeAssistClient, modelCatalogService);
  return { env, oauthService, chatService, modelCatalogService };
}

export async function createApp(input: Partial<AppDependencies> = {}) {
  const env = input.env ?? loadEnv();
  const defaults = await createDefaultDependencies(env);
  const deps: AppDependencies = {
    env,
    oauthService: input.oauthService ?? defaults.oauthService,
    chatService: input.chatService ?? defaults.chatService,
    modelCatalogService: input.modelCatalogService ?? defaults.modelCatalogService
  };

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  app.get("/v1/models", async (request, reply) => {
    try {
      const models = await deps.modelCatalogService.listModels();
      return toOpenAIModelList(models);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500);
      return { error: { message } };
    }
  });

  app.post("/v1/chat/completions", async (request, reply) => {
    try {
      const body = openAIChatCompletionRequestSchema.parse(request.body);
      if (body.stream) {
        if (!deps.chatService.stream) {
          reply.code(400);
          return { error: { message: "stream is not supported" } };
        }
        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });

        for await (const chunk of deps.chatService.stream(body)) {
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        return;
      }

      return deps.chatService.generate(body);
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400);
        return {
          error: {
            message: error.issues.map((issue) => issue.message).join(", ")
          }
        };
      }
      reply.code(500);
      const message = error instanceof Error ? error.message : String(error);
      return { error: { message } };
    }
  });

  app.get("/v1/auth/status", async () => {
    try {
      await deps.oauthService.getAccessToken();
      return { authenticated: true };
    } catch {
      return { authenticated: false };
    }
  });

  return app;
}
