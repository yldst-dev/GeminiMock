import { describe, expect, it, vi } from "vitest";
import type { AccountStore } from "../../src/auth/account-store.js";
import { OAuthService } from "../../src/auth/oauth-service.js";
import { CodeAssistApiError } from "../../src/gemini/errors.js";

describe("OAuthService rotation", () => {
  it("rotates account on 429 quota/capacity errors", async () => {
    const rotateActiveAccount = vi.fn(async () => ({
      id: "b",
      enabled: true,
      created_at: Date.now(),
      updated_at: Date.now(),
      credentials: {
        access_token: "token-b"
      }
    }));
    const store = {
      rotateActiveAccount
    } as unknown as AccountStore;
    const service = new OAuthService(store);
    const error = new CodeAssistApiError(
      "generateContent",
      429,
      "{\"error\":{\"status\":\"RESOURCE_EXHAUSTED\",\"message\":\"No capacity available\"}}"
    );

    const rotated = await service.handleCodeAssistError(error);

    expect(rotated).toBe(true);
    expect(rotateActiveAccount).toHaveBeenCalledTimes(1);
  });

  it("does not rotate on non-rate-limit 4xx errors", async () => {
    const rotateActiveAccount = vi.fn(async () => null);
    const store = {
      rotateActiveAccount
    } as unknown as AccountStore;
    const service = new OAuthService(store);
    const error = new CodeAssistApiError("generateContent", 404, "{\"error\":{\"status\":\"NOT_FOUND\"}}");

    const rotated = await service.handleCodeAssistError(error);

    expect(rotated).toBe(false);
    expect(rotateActiveAccount).not.toHaveBeenCalled();
  });
});
