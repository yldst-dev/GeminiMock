const ALIAS_MAP: Record<string, string> = {
  "gemini-3-flash": "gemini-3-flash-preview",
  "gemini-3-pro": "gemini-3-pro-preview",
  "gemini-3.1-pro": "gemini-3.1-pro-preview"
};

function normalizeList(models: string[]): Set<string> {
  return new Set(models.map((model) => model.trim()).filter((model) => model.length > 0));
}

function stripVertexSuffix(model: string): string {
  return model.endsWith("_vertex") ? model.slice(0, -7) : model;
}

export function resolveRequestedModel(requestedModel: string, availableModels: string[]): string {
  const requested = requestedModel.trim();
  if (!requested) {
    return requestedModel;
  }

  const normalized = normalizeList(availableModels);
  if (normalized.has(requested)) {
    return requested;
  }

  const directAlias = ALIAS_MAP[requested];
  if (directAlias) {
    if (normalized.has(directAlias)) {
      return directAlias;
    }
    const aliasPreview = `${directAlias}-preview`;
    if (normalized.has(aliasPreview)) {
      return aliasPreview;
    }
  }

  const previewCandidate = `${requested}-preview`;
  if (normalized.has(previewCandidate)) {
    return previewCandidate;
  }

  const requestedWithoutPreview = requested.endsWith("-preview")
    ? requested.slice(0, -8)
    : requested;
  if (normalized.has(requestedWithoutPreview)) {
    return requestedWithoutPreview;
  }

  const requestedNoVertex = stripVertexSuffix(requested);
  if (normalized.has(requestedNoVertex)) {
    return requestedNoVertex;
  }

  return requested;
}

export function normalizeModelList(rawModels: string[]): string[] {
  const unique = new Set<string>();
  for (const model of rawModels) {
    const trimmed = model.trim();
    if (!trimmed) {
      continue;
    }
    unique.add(stripVertexSuffix(trimmed));
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}
