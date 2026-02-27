import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";

describe("models route", () => {
  it("returns model list", async () => {
    const app = await createApp({
      oauthService: {
        login: async () => ({ email: "x@y.com" }),
        logout: async () => undefined,
        getAccessToken: async () => "token",
        getClient: async () => {
          throw new Error("not used");
        }
      } as never,
      chatService: {
        generate: async () => {
          throw new Error("not used");
        }
      },
      modelCatalogService: {
        listModels: async () => ["gemini-2.5-flash", "gemini-3-flash-preview"]
      } as never
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.object).toBe("list");
    expect(body.data[0].id).toBe("gemini-2.5-flash");
  });
});
