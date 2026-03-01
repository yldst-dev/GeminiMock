import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";

describe("chat completions route", () => {
  it("accepts all optional request arguments", async () => {
    let capturedRequest: unknown;
    const app = await createApp({
      chatService: {
        generate: async (request) => {
          capturedRequest = request;
          return {
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
          };
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gemini-3-flash",
        stream: false,
        temperature: 0.4,
        top_p: 0.7,
        max_tokens: 512,
        stop: ["<END>", "DONE"],
        thinking_level: "high",
        thinking_config: {
          include_thoughts: true,
          thinking_budget: 4096
        },
        safety_settings: [{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" }],
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(capturedRequest).toMatchObject({
      model: "gemini-3-flash",
      stream: false,
      temperature: 0.4,
      top_p: 0.7,
      max_tokens: 512,
      stop: ["<END>", "DONE"],
      thinking_level: "high",
      thinking_config: {
        include_thoughts: true,
        thinking_budget: 4096
      },
      safety_settings: [{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" }]
    });
  });

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
