export class CodeAssistApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly status: number,
    public readonly body: string,
    public readonly retryAfterMs?: number
  ) {
    super(`Code Assist ${method} failed (${status}): ${body}`);
  }
}

export function parseRetryAfterMs(retryAfter: string | null): number | undefined {
  if (!retryAfter) {
    return undefined;
  }

  const asSeconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return asSeconds * 1000;
  }

  const asDate = Date.parse(retryAfter);
  if (!Number.isFinite(asDate)) {
    return undefined;
  }

  const delta = asDate - Date.now();
  return delta > 0 ? delta : undefined;
}
