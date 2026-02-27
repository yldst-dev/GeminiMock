import { describe, expect, it } from "vitest";
import { resolveRequestedModel } from "../../src/openai/model-resolver.js";

describe("resolveRequestedModel", () => {
  it("maps gemini-3 aliases to preview models when available", () => {
    const available = ["gemini-3-flash-preview", "gemini-2.5-flash"];
    const resolved = resolveRequestedModel("gemini-3-flash", available);
    expect(resolved).toBe("gemini-3-flash-preview");
  });

  it("returns original model when available", () => {
    const available = ["gemini-2.5-pro"];
    const resolved = resolveRequestedModel("gemini-2.5-pro", available);
    expect(resolved).toBe("gemini-2.5-pro");
  });

  it("falls back to original when no match", () => {
    const available = ["gemini-2.5-pro"];
    const resolved = resolveRequestedModel("custom-model", available);
    expect(resolved).toBe("custom-model");
  });
});
