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
  it("pings the selected account, shows OK, and returns to the selector", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["down", "enter", "enter", "cancel"]);
    const performPing = vi.fn(async () => createPingResult({
      projectId: "utility-density-5bbcp",
      finishReason: "MAX_TOKENS",
      traceId: "38cfa2ef2af0a3d",
      responseText: ""
    }));

    const lines = await runAuthPingFlow({ oauthService, store, io, performPing });

    expect(oauthService.useAccount).toHaveBeenNthCalledWith(1, "a2");
    expect(oauthService.useAccount).toHaveBeenNthCalledWith(2, "a1");
    expect(performPing).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(["Ping cancelled"]);

    const resultScreen = String(io.writeSpy.mock.calls[2]?.[0] ?? "");
    expect(resultScreen).toContain("Status: OK");
    expect(resultScreen).toContain("Ping account: a2 (two@example.com)");
    expect(resultScreen).toContain("Model: gemini-2.5-pro");
    expect(resultScreen).toContain("Project: utility-density-5bbcp");
    expect(resultScreen).toContain("Finish reason: MAX_TOKENS");
    expect(resultScreen).toContain("Trace ID: 38cfa2ef2af0a3d");
    expect(resultScreen).toContain("Response:");
    expect(resultScreen).toContain("(empty)");

    const returnedSelector = String(io.writeSpy.mock.calls[3]?.[0] ?? "");
    expect(returnedSelector).toContain("GeminiMock Account Ping Selector");
  });

  it("uses the active account directly when not running in a TTY", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO([], false);
    const performPing = vi.fn(async () => createPingResult({ responseText: "ready" }));

    const lines = await runAuthPingFlow({ oauthService, store, io, performPing });

    expect(oauthService.useAccount).not.toHaveBeenCalled();
    expect(performPing).toHaveBeenCalledTimes(1);
    expect(lines).toContain("Ping account: a1 (one@example.com)");
    expect(lines).toContain("Status: FAIL");
    expect(lines).toContain("Reason: Missing project, finish reason, trace id");
    expect(lines).toContain("ready");
  });

  it("shows OK when the ping returns the expected diagnostics", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO([], false);
    const performPing = vi.fn(async () => createPingResult({
      projectId: "utility-density-5bbcp",
      finishReason: "MAX_TOKENS",
      traceId: "38cfa2ef2af0a3d",
      responseText: ""
    }));

    const lines = await runAuthPingFlow({ oauthService, store, io, performPing });

    expect(lines).toContain("Status: OK");
    expect(lines).toContain("Project: utility-density-5bbcp");
    expect(lines).toContain("Finish reason: MAX_TOKENS");
    expect(lines).toContain("Trace ID: 38cfa2ef2af0a3d");
    expect(lines).toContain("(empty)");
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

  it("restores the previous active account and shows FAIL when ping throws", async () => {
    const { oauthService, store } = createHarness();
    const io = createIO(["down", "enter", "cancel"]);
    const performPing = vi.fn(async () => {
      throw new Error("Ping failed");
    });

    const lines = await runAuthPingFlow({ oauthService, store, io, performPing });

    expect(lines).toEqual(["Ping cancelled"]);
    expect(oauthService.useAccount).toHaveBeenNthCalledWith(1, "a2");
    expect(oauthService.useAccount).toHaveBeenNthCalledWith(2, "a1");

    const resultScreen = String(io.writeSpy.mock.calls[2]?.[0] ?? "");
    expect(resultScreen).toContain("Status: FAIL");
    expect(resultScreen).toContain("Error: Ping failed");
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
