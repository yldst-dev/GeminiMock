import { z } from "zod";

const contentItemSchema = z.object({
  type: z.literal("text"),
  text: z.string()
});

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "developer", "tool"]),
  content: z.union([z.string(), z.array(contentItemSchema)])
});

const safetySettingSchema = z.object({
  category: z.string().min(1),
  threshold: z.string().min(1),
  method: z.string().optional()
});

const thinkingConfigSchema = z.object({
  include_thoughts: z.boolean().optional(),
  includeThoughts: z.boolean().optional(),
  thinking_budget: z.number().int().optional(),
  thinkingBudget: z.number().int().optional(),
  thinking_level: z.string().min(1).optional(),
  thinkingLevel: z.string().min(1).optional()
});

export const openAIChatCompletionRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().int().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  thinking_level: z.string().min(1).optional(),
  thinkingLevel: z.string().min(1).optional(),
  thinking_config: thinkingConfigSchema.optional(),
  thinkingConfig: thinkingConfigSchema.optional(),
  safety_settings: z.array(safetySettingSchema).optional(),
  safetySettings: z.array(safetySettingSchema).optional()
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
