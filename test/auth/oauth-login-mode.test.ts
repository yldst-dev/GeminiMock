import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountStore } from "../../src/auth/account-store.js";
import type { OAuthServiceIO } from "../../src/auth/oauth-service.js";
import { OAuthService, resolveOAuthLoginMode } from "../../src/auth/oauth-service.js";

const ORIGINAL_ENV = {
  GEMINI_CLI_OAUTH_CLIENT_ID: process.env.GEMINI_CLI_OAUTH_CLIENT_ID,
  GEMINI_CLI_OAUTH_CLIENT_SECRET: process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET,
  GEMINIMOCK_OAUTH_LOGIN_MODE: process.env.GEMINIMOCK_OAUTH_LOGIN_MODE,
  GEMINIMOCK_OAUTH_FORCE_MANUAL: process.env.GEMINIMOCK_OAUTH_FORCE_MANUAL,
  SSH_CONNECTION: process.env.SSH_CONNECTION,
  SSH_CLIENT: process.env.SSH_CLIENT,
  SSH_TTY: process.env.SSH_TTY,
  CI: process.env.CI,
  DISPLAY: process.env.DISPLAY,
  WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
  MIR_SOCKET: process.env.MIR_SOCKET
};

type OAuthServiceInternals = {
  loginWithWebCallback(io: OAuthServiceIO): Promise<{ email?: string }>;
  loginManual(io: OAuthServiceIO): Promise<{ email?: string }>;
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function configureOAuthClientEnv() {
  process.env.GEMINI_CLI_OAUTH_CLIENT_ID = "id-123";
  process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET = "secret-123";
}

function clearDetectionEnv() {
  delete process.env.GEMINIMOCK_OAUTH_LOGIN_MODE;
  delete process.env.GEMINIMOCK_OAUTH_FORCE_MANUAL;
  delete process.env.SSH_CONNECTION;
  delete process.env.SSH_CLIENT;
  delete process.env.SSH_TTY;
  delete process.env.CI;
  process.env.DISPLAY = ":99";
  delete process.env.WAYLAND_DISPLAY;
  delete process.env.MIR_SOCKET;
}

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe("resolveOAuthLoginMode", () => {
  it("resolves to manual on remote ssh environment", () => {
    clearDetectionEnv();
    process.env.SSH_CONNECTION = "10.0.0.1 22 10.0.0.2 34321";
    expect(resolveOAuthLoginMode("auto")).toBe("manual");
  });

  it("respects explicit web mode", () => {
    clearDetectionEnv();
    process.env.SSH_CONNECTION = "10.0.0.1 22 10.0.0.2 34321";
    expect(resolveOAuthLoginMode("web")).toBe("web");
  });

  it("respects environment override mode", () => {
    clearDetectionEnv();
    process.env.GEMINIMOCK_OAUTH_LOGIN_MODE = "manual";
    expect(resolveOAuthLoginMode("auto")).toBe("manual");
  });
});

describe("OAuthService login mode behavior", () => {
  it("uses manual login directly when auto mode resolves to manual", async () => {
    configureOAuthClientEnv();
    clearDetectionEnv();
    process.env.SSH_CONNECTION = "10.0.0.1 22 10.0.0.2 34321";

    const service = new OAuthService({} as unknown as AccountStore);
    const internals = service as unknown as OAuthServiceInternals;
    const webSpy = vi.spyOn(internals, "loginWithWebCallback").mockResolvedValue({ email: "web@example.com" });
    const manualSpy = vi.spyOn(internals, "loginManual").mockResolvedValue({ email: "manual@example.com" });
    const io: OAuthServiceIO = {
      write: vi.fn(),
      readCode: vi.fn(async () => "code")
    };

    const result = await service.login(io, "auto");

    expect(webSpy).not.toHaveBeenCalled();
    expect(manualSpy).toHaveBeenCalledTimes(1);
    expect(result.email).toBe("manual@example.com");
  });

  it("falls back to manual when web callback flow fails in auto mode", async () => {
    configureOAuthClientEnv();
    clearDetectionEnv();

    const service = new OAuthService({} as unknown as AccountStore);
    const internals = service as unknown as OAuthServiceInternals;
    const webSpy = vi.spyOn(internals, "loginWithWebCallback").mockRejectedValue(new Error("callback failed"));
    const manualSpy = vi.spyOn(internals, "loginManual").mockResolvedValue({ email: "manual@example.com" });
    const io: OAuthServiceIO = {
      write: vi.fn(),
      readCode: vi.fn(async () => "code")
    };

    const result = await service.login(io, "auto");

    expect(webSpy).toHaveBeenCalledTimes(1);
    expect(manualSpy).toHaveBeenCalledTimes(1);
    expect(result.email).toBe("manual@example.com");
  });
});
