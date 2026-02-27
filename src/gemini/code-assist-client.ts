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

  constructor(
    private readonly env: AppEnv,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  private buildUrl(method: string, query?: URLSearchParams): string {
    const base = `${this.env.codeAssistEndpoint}/${this.env.codeAssistApiVersion}:${method}`;
    if (!query) {
      return base;
    }
    return `${base}?${query.toString()}`;
  }

  private async postJson<T>(method: string, body: unknown, query?: URLSearchParams): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(this.buildUrl(method, query), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Code Assist ${method} failed (${response.status}): ${text}`);
    }

    return (await response.json()) as T;
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
    const token = await this.getAccessToken();
    const response = await fetch(`${this.env.codeAssistEndpoint}/${this.env.codeAssistApiVersion}/${name}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Code Assist operation failed (${response.status}): ${text}`);
    }
    return (await response.json()) as LongRunningOperationResponse;
  }

  async resolveProjectId(): Promise<string | undefined> {
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
    const token = await this.getAccessToken();
    const query = new URLSearchParams({ alt: "sse" });
    const response = await fetch(this.buildUrl("streamGenerateContent", query), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Code Assist streamGenerateContent failed (${response.status}): ${text}`);
    }

    if (!response.body) {
      throw new Error("Empty stream body");
    }

    for await (const chunk of parseSseStream(response.body)) {
      const parsed = JSON.parse(chunk) as CaGenerateContentResponse;
      yield parsed;
    }
  }
}
