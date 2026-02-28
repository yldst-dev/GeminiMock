import type { AppEnv } from "../config/env.js";
import type {
  CAGenerateContentRequest,
  CaGenerateContentResponse,
  LoadCodeAssistRequest,
  LoadCodeAssistResponse,
  LongRunningOperationResponse,
  OnboardUserRequest,
  RetrieveUserQuotaResponse
} from "./types.js";
import { CodeAssistApiError, parseRetryAfterMs } from "./errors.js";

function platformToCode(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === "darwin" && a === "arm64") return "DARWIN_ARM64";
  if (p === "darwin") return "DARWIN_AMD64";
  if (p === "win32") return "WINDOWS_AMD64";
  if (a === "arm64") return "LINUX_ARM64";
  return "LINUX_AMD64";
}

function defaultMetadata(projectId?: string) {
  return {
    ideType: "GEMINI_CLI",
    platform: platformToCode(),
    pluginType: "GEMINI",
    duetProject: projectId
  };
}

async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    buffer += decoder.decode(next.value, { stream: true });

    while (true) {
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex < 0) {
        break;
      }
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const dataLines = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6).trim())
        .filter((line) => line.length > 0);
      if (dataLines.length > 0) {
        yield dataLines.join("\n");
      }
    }
  }
}

export class CodeAssistClient {
  private projectCache?: string;
  private projectCacheAccountKey?: string;

  constructor(
    private readonly env: AppEnv,
    private readonly getAccessToken: () => Promise<string>,
    private readonly hooks: {
      onApiError?: (error: CodeAssistApiError) => Promise<boolean>;
      onApiSuccess?: () => Promise<void>;
      maxAttempts?: () => number | Promise<number>;
      getAccountCacheKey?: () => string | undefined | Promise<string | undefined>;
    } = {}
  ) {}

  private async resolveAccountCacheKey(): Promise<string | undefined> {
    const key = this.hooks.getAccountCacheKey ? await this.hooks.getAccountCacheKey() : undefined;
    return key ?? undefined;
  }

  private async refreshCacheContext(): Promise<void> {
    const accountKey = await this.resolveAccountCacheKey();
    if (accountKey !== this.projectCacheAccountKey) {
      this.projectCache = undefined;
      this.projectCacheAccountKey = accountKey;
    }
  }

  private async invalidateProjectCache(): Promise<void> {
    this.projectCache = undefined;
    this.projectCacheAccountKey = await this.resolveAccountCacheKey();
  }

  private async resolveAttempts(): Promise<number> {
    const candidate = this.hooks.maxAttempts ? await this.hooks.maxAttempts() : 1;
    if (!Number.isFinite(candidate) || candidate < 1) {
      return 1;
    }
    return Math.floor(candidate);
  }

  private async withJsonRetry<T>(
    method: string,
    execute: (token: string) => Promise<Response>,
    onRetry?: () => Promise<void>
  ): Promise<T> {
    const attempts = await this.resolveAttempts();
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const token = await this.getAccessToken();
      const response = await execute(token);
      if (response.ok) {
        const payload = (await response.json()) as T;
        await this.hooks.onApiSuccess?.();
        return payload;
      }

      const body = await response.text();
      const error = new CodeAssistApiError(
        method,
        response.status,
        body,
        parseRetryAfterMs(response.headers.get("retry-after"))
      );
      const canRetry = attempt < attempts && await this.hooks.onApiError?.(error);
      if (!canRetry) {
        throw error;
      }
      await this.invalidateProjectCache();
      await onRetry?.();
    }
    throw new Error(`Code Assist ${method} failed`);
  }

  private async withStreamRetry(
    method: string,
    execute: (token: string) => Promise<Response>,
    onRetry?: () => Promise<void>
  ): Promise<Response> {
    const attempts = await this.resolveAttempts();
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const token = await this.getAccessToken();
      const response = await execute(token);
      if (response.ok) {
        await this.hooks.onApiSuccess?.();
        return response;
      }

      const body = await response.text();
      const error = new CodeAssistApiError(
        method,
        response.status,
        body,
        parseRetryAfterMs(response.headers.get("retry-after"))
      );
      const canRetry = attempt < attempts && await this.hooks.onApiError?.(error);
      if (!canRetry) {
        throw error;
      }
      await this.invalidateProjectCache();
      await onRetry?.();
    }
    throw new Error(`Code Assist ${method} failed`);
  }

  private buildUrl(method: string, query?: URLSearchParams): string {
    const base = `${this.env.codeAssistEndpoint}/${this.env.codeAssistApiVersion}:${method}`;
    if (!query) {
      return base;
    }
    return `${base}?${query.toString()}`;
  }

  private async postJson<T>(method: string, body: unknown, query?: URLSearchParams): Promise<T> {
    return this.withJsonRetry<T>(method, async (token) => {
      return fetch(this.buildUrl(method, query), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
    }, async () => {
      if (method === "generateContent") {
        const payload = body as { project?: string };
        payload.project = await this.resolveProjectId();
      }
    });
  }

  async loadCodeAssist(projectId?: string): Promise<LoadCodeAssistResponse> {
    const request: LoadCodeAssistRequest = {
      cloudaicompanionProject: projectId,
      metadata: defaultMetadata(projectId)
    };
    return this.postJson<LoadCodeAssistResponse>("loadCodeAssist", request);
  }

  async onboardUser(request: OnboardUserRequest): Promise<LongRunningOperationResponse> {
    return this.postJson<LongRunningOperationResponse>("onboardUser", request);
  }

  async retrieveUserQuota(projectId: string): Promise<RetrieveUserQuotaResponse> {
    return this.postJson<RetrieveUserQuotaResponse>("retrieveUserQuota", { project: projectId });
  }

  async getOperation(name: string): Promise<LongRunningOperationResponse> {
    return this.withJsonRetry<LongRunningOperationResponse>("operation", async (token) => {
      return fetch(`${this.env.codeAssistEndpoint}/${this.env.codeAssistApiVersion}/${name}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    });
  }

  async resolveProjectId(): Promise<string | undefined> {
    await this.refreshCacheContext();
    if (this.projectCache) {
      return this.projectCache;
    }

    const initialProject = this.env.projectId;
    const loaded = await this.loadCodeAssist(initialProject);

    if (loaded.cloudaicompanionProject) {
      this.projectCache = loaded.cloudaicompanionProject;
      return this.projectCache;
    }

    if (initialProject && loaded.currentTier) {
      this.projectCache = initialProject;
      return this.projectCache;
    }

    const tier = loaded.allowedTiers?.find((item) => item.isDefault) ?? loaded.allowedTiers?.[0];
    const onboard = await this.onboardUser({
      tierId: tier?.id,
      cloudaicompanionProject: tier?.id === "free-tier" ? undefined : initialProject,
      metadata: defaultMetadata(initialProject)
    });

    if (onboard.done && onboard.response?.cloudaicompanionProject?.id) {
      this.projectCache = onboard.response.cloudaicompanionProject.id;
      return this.projectCache;
    }

    if (onboard.name && !onboard.done) {
      let poll = onboard;
      for (let i = 0; i < 12; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        poll = await this.getOperation(onboard.name);
        if (poll.done) {
          if (poll.response?.cloudaicompanionProject?.id) {
            this.projectCache = poll.response.cloudaicompanionProject.id;
            return this.projectCache;
          }
          break;
        }
      }
    }

    if (initialProject) {
      this.projectCache = initialProject;
      return this.projectCache;
    }

    return undefined;
  }

  async generateContent(request: CAGenerateContentRequest): Promise<CaGenerateContentResponse> {
    return this.postJson<CaGenerateContentResponse>("generateContent", request);
  }

  async *streamGenerateContent(request: CAGenerateContentRequest): AsyncGenerator<CaGenerateContentResponse> {
    const query = new URLSearchParams({ alt: "sse" });
    const response = await this.withStreamRetry("streamGenerateContent", async (token) => {
      return fetch(this.buildUrl("streamGenerateContent", query), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(request)
      });
    }, async () => {
      request.project = await this.resolveProjectId();
    });

    if (!response.body) {
      throw new Error("Empty stream body");
    }

    for await (const chunk of parseSseStream(response.body)) {
      const parsed = JSON.parse(chunk) as CaGenerateContentResponse;
      yield parsed;
    }
  }
}
