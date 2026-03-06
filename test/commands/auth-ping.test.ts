import { describe, expect, it, vi } from "vitest";
import type { StoredAccount } from "../../src/auth/account-store.js";
import { runAuthPingFlow, type PingKey, type PingResult, type PingTuiIO } from "../../src/commands/auth-ping.js";

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
  const accounts: StoredAccount[] = [
    createAccount("a1", "one@example.com"),
    createAccount("a2", "two@example.com")
  ];
  let activeId = "a1";

  const oauthService = {
    listAccounts: vi.fn(async () => accounts.map((account) => ({ ...account }))),
    useAccount: vi.fn(async (idOrEmail: string) => {
      const key = idOrEmail.trim().toLowerCase();
      const selected = accounts.find(
        (account) => account.id === idOrEmail || account.email?.toLowerCase() === key
      );
      if (!selected) {
        throw new Error(`Account not found: ${idOrEmail}`);
      }
      activeId = selected.id;
      return { ...selected };
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
  keys: PingKey[],
  isTTY = true
): PingTuiIO & { writeSpy: ReturnType<typeof vi.fn>; clearSpy: ReturnType<typeof vi.fn> } {
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

function createPingResult(overrides: Partial<PingResult> = {}): PingResult {
  return {
    model: "gemini-2.5-pro",
    responseText: "PONG",
    ...overrides
  };
}

describe("runAuthPingFlow", () => {
  it("pings the selected account and restores the previous active account", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["down", "enter"]);
    const performPing = vi.fn(async () => createPingResult());

    const lines = await runAuthPingFlow({ oauthService, store, io, performPing });

    expect(oauthService.useAccount).toHaveBeenNthCalledWith(1, "a2");
    expect(oauthService.useAccount).toHaveBeenNthCalledWith(2, "a1");
    expect(performPing).toHaveBeenCalledTimes(1);
    expect(lines).toContain("Ping account: a2 (two@example.com)");
    expect(lines).toContain("Model: gemini-2.5-pro");
    expect(lines).toContain("Response:");
    expect(lines).toContain("PONG");
  });

  it("uses the active account directly when not running in a TTY", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO([], false);
    const performPing = vi.fn(async () => createPingResult({ responseText: "ready" }));

    const lines = await runAuthPingFlow({ oauthService, store, io, performPing });

    expect(oauthService.useAccount).not.toHaveBeenCalled();
    expect(performPing).toHaveBeenCalledTimes(1);
    expect(lines).toContain("Ping account: a1 (one@example.com)");
    expect(lines).toContain("ready");
  });

  it("cancels when the cancel row is selected", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["down", "down", "enter"]);
    const performPing = vi.fn(async () => createPingResult());

    const lines = await runAuthPingFlow({ oauthService, store, io, performPing });

    expect(performPing).not.toHaveBeenCalled();
    expect(oauthService.useAccount).not.toHaveBeenCalled();
    expect(lines).toEqual(["Ping cancelled"]);
  });

  it("restores the previous active account when ping fails", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["down", "enter"]);
    const performPing = vi.fn(async () => {
      throw new Error("Ping failed");
    });

    await expect(runAuthPingFlow({ oauthService, store, io, performPing })).rejects.toThrow("Ping failed");
    expect(oauthService.useAccount).toHaveBeenNthCalledWith(1, "a2");
    expect(oauthService.useAccount).toHaveBeenNthCalledWith(2, "a1");
  });

  it("shows the active account legend in the selector screen", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["cancel"]);
    const performPing = vi.fn(async () => createPingResult());

    await runAuthPingFlow({ oauthService, store, io, performPing });

    const firstScreen = String(io.writeSpy.mock.calls[0]?.[0] ?? "");
    expect(firstScreen).toContain("Legend: [*] active account");
  });
});
