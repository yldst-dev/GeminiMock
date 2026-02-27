import type { CodeAssistClient } from "./code-assist-client.js";
import { normalizeModelList } from "../openai/model-resolver.js";

export class ModelCatalogService {
  private cache?: {
    expiresAt: number;
    models: string[];
  };

  constructor(
    private readonly codeAssistClient: CodeAssistClient,
    private readonly ttlMs: number = 60_000
  ) {}

  async listModels(forceRefresh = false): Promise<string[]> {
    const now = Date.now();
    if (!forceRefresh && this.cache && this.cache.expiresAt > now) {
      return this.cache.models;
    }

    const projectId = await this.codeAssistClient.resolveProjectId();
    if (!projectId) {
      return [];
    }

    const quota = await this.codeAssistClient.retrieveUserQuota(projectId);
    const rawModels = (quota.buckets ?? [])
      .map((bucket) => bucket.modelId)
      .filter((model): model is string => typeof model === "string");

    const models = normalizeModelList(rawModels);
    this.cache = {
      expiresAt: now + this.ttlMs,
      models
    };

    return models;
  }
}
