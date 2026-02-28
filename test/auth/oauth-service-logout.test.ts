import { describe, expect, it, vi } from "vitest";
import type { AccountStore } from "../../src/auth/account-store.js";
import { OAuthService } from "../../src/auth/oauth-service.js";

describe("OAuthService logout", () => {
  it("logs out only the active account by default", async () => {
    const logoutActive = vi.fn(async () => null);
    const clearAll = vi.fn(async () => undefined);
    const store = {
      logoutActive,
      clearAll
    } as unknown as AccountStore;

    const service = new OAuthService(store);
    await service.logout();

    expect(logoutActive).toHaveBeenCalledTimes(1);
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("clears all accounts for logoutAll", async () => {
    const logoutActive = vi.fn(async () => null);
    const clearAll = vi.fn(async () => undefined);
    const store = {
      logoutActive,
      clearAll
    } as unknown as AccountStore;

    const service = new OAuthService(store);
    await service.logoutAll();

    expect(logoutActive).not.toHaveBeenCalled();
    expect(clearAll).toHaveBeenCalledTimes(1);
  });
});
