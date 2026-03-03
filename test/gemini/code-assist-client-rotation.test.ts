import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeAssistClient } from "../../src/gemini/code-assist-client.js";
import { CodeAssistApiError } from "../../src/gemini/errors.js";

const env = {
  host: "127.0.0.1",
  port: 43173,
  defaultModel: "gemini-2.5-pro",
  codeAssistEndpoint: "https://example.test",
  codeAssistApiVersion: "v1internal",
  accountsPath: "/tmp/accounts.json",
  oauthPath: "/tmp/oauth.json",
  oauthFallbackPath: "/tmp/fallback.json",
  projectId: undefined
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CodeAssistClient retry", () => {
  it("retries with rotated account when hook allows", async () => {
    const onApiError = vi.fn(async () => true);
    const onApiSuccess = vi.fn(async () => undefined);
    const getAccessToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("token-a")
      .mockResolvedValueOnce("token-b");

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{\"error\":{\"status\":\"RESOURCE_EXHAUSTED\"}}", { status: 429 }))
      .mockResolvedValueOnce(new Response("{\"models\":[{\"name\":\"m\"}]}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodeAssistClient(env, getAccessToken, {
      onApiError,
      onApiSuccess,
      maxAttempts: () => 2
    });

    const result = await client.retrieveUserQuota("project-x");

    expect(result).toBeDefined();
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(onApiError).toHaveBeenCalledTimes(1);
    expect(onApiSuccess).toHaveBeenCalledTimes(1);
  });

  it("throws when retry hook declines rotation", async () => {
    const onApiError = vi.fn(async () => false);
    const getAccessToken = vi.fn(async () => "token-a");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{\"error\":{\"status\":\"RESOURCE_EXHAUSTED\"}}", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodeAssistClient(env, getAccessToken, {
      onApiError,
      maxAttempts: () => 2
    });

    await expect(client.retrieveUserQuota("project-x")).rejects.toBeInstanceOf(CodeAssistApiError);
    expect(onApiError).toHaveBeenCalledTimes(1);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it("calls rotation hook even on final attempt", async () => {
    const onApiError = vi.fn(async () => false);
    const getAccessToken = vi.fn(async () => "token-a");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{\"error\":{\"status\":\"RESOURCE_EXHAUSTED\"}}", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodeAssistClient(env, getAccessToken, {
      onApiError,
      maxAttempts: () => 1
    });

    await expect(client.retrieveUserQuota("project-x")).rejects.toBeInstanceOf(CodeAssistApiError);
    expect(onApiError).toHaveBeenCalledTimes(1);
  });

  it("parses retry window from 429 body when retry-after header is missing", async () => {
    const onApiError = vi.fn(async () => false);
    const getAccessToken = vi.fn(async () => "token-a");
    const body = JSON.stringify({
      error: {
        code: 429,
        message: "You have exhausted your capacity on this model. Your quota will reset after 0s."
      }
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(body, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodeAssistClient(env, getAccessToken, {
      onApiError,
      maxAttempts: () => 1
    });

    await expect(client.retrieveUserQuota("project-x")).rejects.toMatchObject({
      retryAfterMs: 0
    });
  });

  it("invalidates cached project when account cache key changes", async () => {
    let accountKey = "acct-a";
    const getAccessToken = vi.fn(async () => "token-a");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{\"cloudaicompanionProject\":\"project-a\"}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{\"cloudaicompanionProject\":\"project-b\"}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodeAssistClient(env, getAccessToken, {
      getAccountCacheKey: () => accountKey
    });

    const first = await client.resolveProjectId();
    const cached = await client.resolveProjectId();
    accountKey = "acct-b";
    const second = await client.resolveProjectId();

    expect(first).toBe("project-a");
    expect(cached).toBe("project-a");
    expect(second).toBe("project-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes generateContent project on retry after rotation", async () => {
    let accountKey = "acct-a";
    const getAccessToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("token-a")
      .mockResolvedValueOnce("token-b")
      .mockResolvedValueOnce("token-b");
    const onApiError = vi.fn(async () => {
      accountKey = "acct-b";
      return true;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          "{\"error\":{\"code\":403,\"status\":\"PERMISSION_DENIED\"}}",
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(new Response("{\"cloudaicompanionProject\":\"project-b\"}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{\"response\":{\"candidates\":[]}}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodeAssistClient(env, getAccessToken, {
      onApiError,
      maxAttempts: () => 2,
      getAccountCacheKey: () => accountKey
    });

    const request = {
      model: "gemini-2.5-flash",
      project: "project-a",
      request: {
        contents: [{ role: "user" as const, parts: [{ text: "hello" }] }]
      }
    };
    await client.generateContent(request);

    const firstGenerateBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as { project?: string };
    const secondGenerateBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body ?? "{}")) as { project?: string };
    expect(onApiError).toHaveBeenCalledTimes(1);
    expect(firstGenerateBody.project).toBe("project-a");
    expect(secondGenerateBody.project).toBe("project-b");
    expect(request.project).toBe("project-b");
  });

  it("parses CRLF-delimited SSE stream blocks", async () => {
    const getAccessToken = vi.fn(async () => "token-a");
    const encoder = new TextEncoder();
    const first = JSON.stringify({
      traceId: "trace-1",
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: "Hel" }]
            }
          }
        ]
      }
    });
    const second = JSON.stringify({
      traceId: "trace-1",
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: "lo" }]
            }
          }
        ]
      }
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${first}\r\n\r\n`));
        controller.enqueue(encoder.encode(`data: ${second}\r\n\r\n`));
        controller.close();
      }
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(stream, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodeAssistClient(env, getAccessToken);
    const chunks: string[] = [];
    for await (const chunk of client.streamGenerateContent({
      model: "gemini-2.5-flash",
      project: "project-a",
      request: {
        contents: [{ role: "user" as const, parts: [{ text: "hello" }] }]
      }
    })) {
      chunks.push(chunk.response.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    }

    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("flushes trailing SSE block without terminal separator", async () => {
    const getAccessToken = vi.fn(async () => "token-a");
    const encoder = new TextEncoder();
    const last = JSON.stringify({
      traceId: "trace-2",
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: "Done" }]
            }
          }
        ]
      }
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${last}`));
        controller.close();
      }
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(stream, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodeAssistClient(env, getAccessToken);
    const chunks: string[] = [];
    for await (const chunk of client.streamGenerateContent({
      model: "gemini-2.5-flash",
      project: "project-a",
      request: {
        contents: [{ role: "user" as const, parts: [{ text: "hello" }] }]
      }
    })) {
      chunks.push(chunk.response.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    }

    expect(chunks).toEqual(["Done"]);
  });
});
