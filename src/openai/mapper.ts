import type { CAGenerateContentRequest, CaGenerateContentResponse, VertexContent } from "../gemini/types.js";
import type { OpenAIChatCompletionRequest, OpenAIChatCompletionResponse } from "./types.js";

function normalizeMessageContent(content: string | Array<{ type: "text"; text: string }>): string {
  if (typeof content === "string") {
    return content;
  }
  return content.map((item) => item.text).join("\n");
}

function toVertexRole(role: OpenAIChatCompletionRequest["messages"][number]["role"]): VertexContent["role"] {
  if (role === "assistant") {
    return "model";
  }
  return "user";
}

function normalizeStop(stop: OpenAIChatCompletionRequest["stop"]): string[] | undefined {
  if (!stop) {
    return undefined;
  }
  if (typeof stop === "string") {
    return [stop];
  }
  return stop;
}

export function mapOpenAIToCodeAssist(
  request: OpenAIChatCompletionRequest,
  context: { projectId?: string; defaultModel?: string }
): CAGenerateContentRequest {
  const systemMessages: string[] = [];
  const contents: VertexContent[] = [];

  for (const message of request.messages) {
    const text = normalizeMessageContent(message.content);
    if (message.role === "system") {
      systemMessages.push(text);
      continue;
    }
    contents.push({
      role: toVertexRole(message.role),
      parts: [{ text }]
    });
  }

  return {
    model: request.model ?? context.defaultModel ?? "gemini-2.5-pro",
    project: context.projectId,
    request: {
      contents,
      systemInstruction:
        systemMessages.length > 0
          ? {
              role: "user",
              parts: [{ text: systemMessages.join("\n") }]
            }
          : undefined,
      generationConfig: {
        temperature: request.temperature,
        topP: request.top_p,
        maxOutputTokens: request.max_tokens,
        stopSequences: normalizeStop(request.stop)
      }
    }
  };
}

function extractCandidateText(response: CaGenerateContentResponse): string {
  const parts = response.response.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("");
  return text;
}

export function mapCodeAssistToOpenAI(
  response: CaGenerateContentResponse,
  model: string
): OpenAIChatCompletionResponse {
  const text = extractCandidateText(response);
  const usage = response.response.usageMetadata;
  return {
    id: response.traceId ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: response.response.candidates?.[0]?.finishReason ?? "stop",
        message: {
          role: "assistant",
          content: text
        }
      }
    ],
    usage: {
      prompt_tokens: usage?.promptTokenCount ?? 0,
      completion_tokens: usage?.candidatesTokenCount ?? 0,
      total_tokens: usage?.totalTokenCount ?? 0
    }
  };
}
