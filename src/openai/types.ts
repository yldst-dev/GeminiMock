import { z } from "zod";

const contentItemSchema = z.object({
  type: z.literal("text"),
  text: z.string()
});

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "developer", "tool"]),
  content: z.union([z.string(), z.array(contentItemSchema)])
});

export const openAIChatCompletionRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().int().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional()
});

export type OpenAIChatCompletionRequest = z.infer<typeof openAIChatCompletionRequestSchema>;

export type OpenAIChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: "assistant";
      content: string;
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type OpenAIChatCompletionChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string | null;
    delta: {
      role?: "assistant";
      content?: string;
    };
  }>;
};
