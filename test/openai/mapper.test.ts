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
        stop: ["END"]
      },
      { projectId: "p1" }
    );

    expect(out.model).toBe("gemini-2.5-flash");
    expect(out.project).toBe("p1");
    expect(out.request.systemInstruction?.parts?.[0]?.text).toBe("system");
    expect(out.request.contents.length).toBe(3);
    expect(out.request.contents[1]?.role).toBe("model");
    expect(out.request.generationConfig?.maxOutputTokens).toBe(128);
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
