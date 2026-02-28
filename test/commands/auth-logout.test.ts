import { describe, expect, it, vi } from "vitest";
import type { StoredAccount } from "../../src/auth/account-store.js";
import { runAuthLogoutFlow, type LogoutKey, type LogoutTuiIO } from "../../src/commands/auth-logout.js";

function createAccount(id: string, email: string): StoredAccount {
  return {
    id,
    email,
    enabled: true,
    created_at: 1,
    updated_at: 1,
    last_used_at: undefined,
    cooldown_until: undefined,
    last_error: undefined,
    credentials: {
      access_token: `token-${id}`,
      refresh_token: `refresh-${id}`
    }
  };
}

function createHarness() {
  let accounts: StoredAccount[] = [
    createAccount("a1", "one@example.com"),
    createAccount("a2", "two@example.com")
  ];
  let activeId = "a1";

  const oauthService = {
    listAccounts: vi.fn(async () => accounts.map((account) => ({ ...account }))),
    logout: vi.fn(async () => {
      const index = accounts.findIndex((account) => account.id === activeId);
      if (index < 0) {
        return null;
      }
      const removed = accounts.splice(index, 1)[0] ?? null;
      activeId = accounts[0]?.id ?? "";
      return removed;
    }),
    logoutAll: vi.fn(async () => {
      accounts = [];
      activeId = "";
    }),
    removeAccount: vi.fn(async (idOrEmail: string) => {
      const key = idOrEmail.trim().toLowerCase();
      const index = accounts.findIndex(
        (account) => account.id === idOrEmail || account.email?.toLowerCase() === key
      );
      if (index < 0) {
        return false;
      }
      const removed = accounts.splice(index, 1)[0];
      if (removed?.id === activeId) {
        activeId = accounts[0]?.id ?? "";
      }
      return true;
    })
  };

  const store = {
    getActiveAccount: vi.fn(async () => {
      return accounts.find((account) => account.id === activeId) ?? null;
    })
  };

  return { oauthService, store };
}

function createIO(
  keys: LogoutKey[],
  isTTY = true
): LogoutTuiIO & { writeSpy: ReturnType<typeof vi.fn>; clearSpy: ReturnType<typeof vi.fn> } {
  const queue = [...keys];
  const writeSpy = vi.fn();
  const clearSpy = vi.fn();
  return {
    isTTY,
    write: writeSpy,
    clear: clearSpy,
    readKey: vi.fn(async () => queue.shift() ?? "cancel"),
    writeSpy,
    clearSpy
  };
}

describe("runAuthLogoutFlow", () => {
  it("logs out selected non-active account and keeps active account", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["down", "enter"]);

    const lines = await runAuthLogoutFlow({ oauthService, store, io });

    expect(oauthService.removeAccount).toHaveBeenCalledWith("a2");
    expect(oauthService.logout).not.toHaveBeenCalled();
    expect(lines).toContain("Logged out account: a2 (two@example.com)");
    expect(lines).toContain("Active account unchanged: a1 (one@example.com)");
  });

  it("logs out active account when active row is selected", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["enter"]);

    const lines = await runAuthLogoutFlow({ oauthService, store, io });

    expect(oauthService.logout).toHaveBeenCalledTimes(1);
    expect(lines).toContain("Logged out account: a1 (one@example.com)");
    expect(lines).toContain("Active account switched to: a2 (two@example.com)");
  });

  it("cancels logout on cancel key", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["cancel"]);

    const lines = await runAuthLogoutFlow({ oauthService, store, io });

    expect(oauthService.logout).not.toHaveBeenCalled();
    expect(oauthService.removeAccount).not.toHaveBeenCalled();
    expect(lines).toEqual(["Logout cancelled"]);
  });

  it("shows active account legend in TUI screen", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["cancel"]);

    await runAuthLogoutFlow({ oauthService, store, io });

    const firstScreen = String(io.writeSpy.mock.calls[0]?.[0] ?? "");
    expect(firstScreen).toContain("Legend: [*] active account");
  });

  it("cancels when cancel row is selected and enter is pressed", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["down", "down", "down", "enter"]);

    const lines = await runAuthLogoutFlow({ oauthService, store, io });

    expect(oauthService.logout).not.toHaveBeenCalled();
    expect(oauthService.removeAccount).not.toHaveBeenCalled();
    expect(lines).toEqual(["Logout cancelled"]);
  });

  it("logs out all when selecting all and confirming yes", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["down", "down", "enter", "down", "enter"]);

    const lines = await runAuthLogoutFlow({ oauthService, store, io });

    expect(oauthService.logoutAll).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(["All OAuth accounts cleared"]);
  });

  it("cancels all logout when selecting no in confirmation", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["down", "down", "enter", "enter"]);

    const lines = await runAuthLogoutFlow({ oauthService, store, io });

    expect(oauthService.logoutAll).not.toHaveBeenCalled();
    expect(lines).toEqual(["Logout cancelled"]);
  });
});
