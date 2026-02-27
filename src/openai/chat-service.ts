import type { CodeAssistClient } from "../gemini/code-assist-client.js";
import type { ModelCatalogService } from "../gemini/model-catalog-service.js";
import type { OpenAIChatCompletionChunk, OpenAIChatCompletionRequest, OpenAIChatCompletionResponse } from "./types.js";
import { mapCodeAssistToOpenAI, mapOpenAIToCodeAssist } from "./mapper.js";
import { resolveRequestedModel } from "./model-resolver.js";

export class OpenAIChatService {
  constructor(
    private readonly defaultModel: string,
    private readonly codeAssistClient: CodeAssistClient,
    private readonly modelCatalogService?: ModelCatalogService
  ) {}

  private async resolveModel(requestedModel: string | undefined): Promise<string> {
    const requested = requestedModel ?? this.defaultModel;
    if (!this.modelCatalogService) {
      return requested;
    }

    try {
      const models = await this.modelCatalogService.listModels();
      return resolveRequestedModel(requested, models);
    } catch {
      return requested;
    }
  }

  async generate(request: OpenAIChatCompletionRequest): Promise<OpenAIChatCompletionResponse> {
    const resolvedModel = await this.resolveModel(request.model);
    const projectId = await this.codeAssistClient.resolveProjectId();
    const mapped = mapOpenAIToCodeAssist(
      {
        ...request,
        model: resolvedModel
      },
      {
        projectId,
        defaultModel: this.defaultModel
      }
    );
    const response = await this.codeAssistClient.generateContent(mapped);
    return mapCodeAssistToOpenAI(response, mapped.model);
  }

  async *stream(request: OpenAIChatCompletionRequest): AsyncGenerator<OpenAIChatCompletionChunk> {
    const resolvedModel = await this.resolveModel(request.model);
    const projectId = await this.codeAssistClient.resolveProjectId();
    const mapped = mapOpenAIToCodeAssist(
      {
        ...request,
        model: resolvedModel
      },
      {
        projectId,
        defaultModel: this.defaultModel
      }
    );

    for await (const chunk of this.codeAssistClient.streamGenerateContent(mapped)) {
      const text = chunk.response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      yield {
        id: chunk.traceId ?? `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: mapped.model,
        choices: [
          {
            index: 0,
            finish_reason: null,
            delta: {
              role: "assistant",
              content: text
            }
          }
        ]
      };
    }

    yield {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: mapped.model,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          delta: {}
        }
      ]
    };
  }
}
