import { describe, expect, it } from "vitest";
import { parseOAuthInput } from "../../src/auth/oauth-flow.js";

describe("parseOAuthInput", () => {
  it("parses full callback URL", () => {
    const parsed = parseOAuthInput(
      "https://codeassist.google.com/authcode?state=s1&code=c1"
    );
    expect(parsed.state).toBe("s1");
    expect(parsed.code).toBe("c1");
  });

  it("parses raw code", () => {
    const parsed = parseOAuthInput("4/abc");
    expect(parsed.code).toBe("4/abc");
    expect(parsed.state).toBeUndefined();
  });

  it("throws on invalid URL without code", () => {
    expect(() =>
      parseOAuthInput("https://codeassist.google.com/authcode?state=s1")
    ).toThrow();
  });
});
