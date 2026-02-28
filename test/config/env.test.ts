import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";

describe("loadEnv", () => {
  it("loads defaults", () => {
    const env = loadEnv({});
    expect(env.host).toBe("127.0.0.1");
    expect(env.port).toBe(43173);
    expect(env.accountsPath).toContain(".geminimock");
    expect(env.codeAssistEndpoint).toBe("https://cloudcode-pa.googleapis.com");
    expect(env.codeAssistApiVersion).toBe("v1internal");
  });

  it("parses custom values", () => {
    const env = loadEnv({
      GEMINI_CLI_API_HOST: "0.0.0.0",
      GEMINI_CLI_API_PORT: "9090",
      GEMINI_CLI_MODEL: "gemini-2.5-flash"
    });
    expect(env.host).toBe("0.0.0.0");
    expect(env.port).toBe(9090);
    expect(env.defaultModel).toBe("gemini-2.5-flash");
  });
});
