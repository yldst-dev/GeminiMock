import { describe, expect, it, vi } from "vitest";
import { runAuthLoginFlow, type LoginTuiIO, type LoginKey } from "../../src/commands/auth-login.js";

function createIO(
  keys: LoginKey[]
): LoginTuiIO & { writeSpy: ReturnType<typeof vi.fn>; clearSpy: ReturnType<typeof vi.fn> } {
  const queue = [...keys];
  const writeSpy = vi.fn();
  const clearSpy = vi.fn();
  return {
    isTTY: true,
    write: writeSpy,
    clear: clearSpy,
    readKey: vi.fn(async () => queue.shift() ?? "cancel"),
    writeSpy,
    clearSpy
  };
}

describe("runAuthLoginFlow", () => {
  it("cancels before starting login", async () => {
    const io = createIO(["down", "enter"]);
    const doLogin = vi.fn(async () => ({ email: "one@example.com" }));

    const lines = await runAuthLoginFlow({ io, doLogin });

    expect(doLogin).not.toHaveBeenCalled();
    expect(lines).toEqual(["Login cancelled"]);
  });

  it("runs one login and finishes", async () => {
    const io = createIO(["enter", "down", "enter"]);
    const doLogin = vi.fn(async () => ({ email: "one@example.com" }));

    const lines = await runAuthLoginFlow({ io, doLogin });

    expect(doLogin).toHaveBeenCalledTimes(1);
    expect(lines).toContain("OAuth login succeeded: one@example.com");
    expect(lines).toContain("Login flow finished");
  });

  it("shows the successful account email in Login Completed screen", async () => {
    const io = createIO(["enter", "cancel"]);
    const doLogin = vi.fn(async () => ({ email: "one@example.com" }));

    await runAuthLoginFlow({ io, doLogin });

    const rendered = io.writeSpy.mock.calls.map((call) => String(call[0] ?? ""));
    expect(rendered.some((screen) => screen.includes("Last login account: one@example.com"))).toBe(true);
  });

  it("runs multiple logins with repeat selection", async () => {
    const io = createIO(["enter", "enter", "down", "enter"]);
    const doLogin = vi
      .fn()
      .mockResolvedValueOnce({ email: "one@example.com" })
      .mockResolvedValueOnce({ email: "two@example.com" });

    const lines = await runAuthLoginFlow({ io, doLogin });

    expect(doLogin).toHaveBeenCalledTimes(2);
    expect(lines).toContain("OAuth login succeeded: one@example.com");
    expect(lines).toContain("OAuth login succeeded: two@example.com");
    expect(lines).toContain("Login flow finished");
  });

  it("ignores one immediate cancel right after login completes", async () => {
    const io = createIO(["enter", "cancel", "down", "enter"]);
    const doLogin = vi.fn(async () => ({ email: "one@example.com" }));

    const lines = await runAuthLoginFlow({ io, doLogin });

    expect(doLogin).toHaveBeenCalledTimes(1);
    expect(lines).toContain("OAuth login succeeded: one@example.com");
    expect(lines).toContain("Login flow finished");
  });
});
