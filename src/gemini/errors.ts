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

export function parseRetryAfterMsFromBody(body: string): number | undefined {
  const secondsMatch = body.match(/reset after\s+(\d+)s/i);
  if (secondsMatch?.[1]) {
    const seconds = Number.parseInt(secondsMatch[1], 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }

  const minuteMatch = body.match(/reset after\s+(\d+)m/i);
  if (minuteMatch?.[1]) {
    const minutes = Number.parseInt(minuteMatch[1], 10);
    if (Number.isFinite(minutes) && minutes >= 0) {
      return minutes * 60_000;
    }
  }

  return undefined;
}
