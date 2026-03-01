import { describe, expect, it } from "vitest";
import {
  mapCodeAssistToOpenAI,
  mapOpenAIToCodeAssist
} from "../../src/openai/mapper.js";

describe("OpenAI mapper", () => {
  it("maps openai payload to code assist", () => {
    const out = mapOpenAIToCodeAssist(
      {
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "hello" },
          { role: "assistant", content: "world" },
          { role: "user", content: [{ type: "text", text: "more" }] }
        ],
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 128,
        stop: ["END"],
        thinking_level: "high",
        safety_settings: [
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
        ]
      },
      { projectId: "p1" }
    );

    expect(out.model).toBe("gemini-2.5-flash");
    expect(out.project).toBe("p1");
    expect(out.request.systemInstruction?.parts?.[0]?.text).toBe("system");
    expect(out.request.contents.length).toBe(3);
    expect(out.request.contents[1]?.role).toBe("model");
    expect(out.request.generationConfig?.temperature).toBe(0.2);
    expect(out.request.generationConfig?.maxOutputTokens).toBe(128);
    expect(out.request.generationConfig?.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
    expect(out.request.safetySettings).toEqual([
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
    ]);
  });

  it("maps thinking config options", () => {
    const out = mapOpenAIToCodeAssist(
      {
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "hello" }],
        thinkingLevel: "medium",
        thinkingConfig: {
          includeThoughts: false,
          thinkingBudget: 1024
        }
      },
      { projectId: "p1" }
    );

    expect(out.request.generationConfig?.thinkingConfig).toEqual({
      includeThoughts: false,
      thinkingBudget: 1024,
      thinkingLevel: "MEDIUM"
    });
  });

  it("maps snake_case thinking_config options", () => {
    const out = mapOpenAIToCodeAssist(
      {
        model: "gemini-3-flash",
        messages: [{ role: "user", content: "hello" }],
        thinking_config: {
          include_thoughts: true,
          thinking_budget: 8192,
          thinking_level: "low"
        }
      },
      { projectId: "p1" }
    );

    expect(out.request.generationConfig?.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: 8192,
      thinkingLevel: "LOW"
    });
  });

  it("maps camelCase safetySettings", () => {
    const out = mapOpenAIToCodeAssist(
      {
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "hello" }],
        safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }]
      },
      { projectId: "p1" }
    );

    expect(out.request.safetySettings).toEqual([
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ]);
  });

  it("maps code assist response to openai response", () => {
    const result = mapCodeAssistToOpenAI(
      {
        traceId: "trace-1",
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "answer" }]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15
          }
        }
      },
      "gemini-2.5-pro"
    );

    expect(result.id).toBe("trace-1");
    expect(result.choices[0]?.message.content).toBe("answer");
    expect(result.usage.total_tokens).toBe(15);
  });
});
