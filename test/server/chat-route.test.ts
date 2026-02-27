import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";

describe("chat completions route", () => {
  it("returns completion", async () => {
    const app = await createApp({
      chatService: {
        generate: async () => ({
          id: "id-1",
          object: "chat.completion",
          created: 1,
          model: "gemini-2.5-pro",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "ok" }
            }
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2
          }
        })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gemini-2.5-pro",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.choices[0].message.content).toBe("ok");
  });

  it("validates request body", async () => {
    const app = await createApp({
      chatService: {
        generate: async () => {
          throw new Error("not used");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gemini-2.5-pro"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("streams completion", async () => {
    const app = await createApp({
      chatService: {
        generate: async () => {
          throw new Error("not used");
        },
        async *stream() {
          yield {
            id: "id-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "gemini-2.5-pro",
            choices: [{ index: 0, finish_reason: null, delta: { role: "assistant", content: "he" } }]
          };
          yield {
            id: "id-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "gemini-2.5-pro",
            choices: [{ index: 0, finish_reason: "stop", delta: {} }]
          };
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gemini-2.5-pro",
        stream: true,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.includes("data:")).toBe(true);
    expect(response.body.includes("[DONE]")).toBe(true);
  });
});
