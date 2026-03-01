export type ClientMetadata = {
  ideType?: string;
  platform?: string;
  pluginType?: string;
  duetProject?: string;
};

export type LoadCodeAssistRequest = {
  cloudaicompanionProject?: string;
  metadata: ClientMetadata;
};

export type GeminiUserTier = {
  id: string;
  name?: string;
  isDefault?: boolean;
};

export type LoadCodeAssistResponse = {
  currentTier?: GeminiUserTier | null;
  allowedTiers?: GeminiUserTier[] | null;
  cloudaicompanionProject?: string | null;
};

export type OnboardUserRequest = {
  tierId: string | undefined;
  cloudaicompanionProject: string | undefined;
  metadata: ClientMetadata | undefined;
};

export type LongRunningOperationResponse = {
  name: string;
  done?: boolean;
  response?: {
    cloudaicompanionProject?: {
      id: string;
      name?: string;
    };
  };
};

export type RetrieveUserQuotaResponse = {
  buckets?: Array<{
    modelId?: string;
    tokenType?: string;
    remainingFraction?: number;
    resetTime?: string;
  }>;
};

export type VertexInlineData = {
  mimeType: string;
  data: string;
};

export type VertexPart = {
  text?: string;
  inlineData?: VertexInlineData;
};

export type VertexContent = {
  role: "user" | "model";
  parts: VertexPart[];
};

export type VertexGenerationConfig = {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  responseModalities?: string[];
  candidateCount?: number;
  thinkingConfig?: VertexThinkingConfig;
};

export type VertexThinkingConfig = {
  includeThoughts?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: string;
};

export type VertexSafetySetting = {
  category: string;
  threshold: string;
  method?: string;
};

export type CAGenerateContentRequest = {
  model: string;
  project?: string;
  request: {
    contents: VertexContent[];
    systemInstruction?: VertexContent;
    safetySettings?: VertexSafetySetting[];
    generationConfig?: VertexGenerationConfig;
  };
};

export type CaGenerateContentResponse = {
  traceId?: string;
  response: {
    candidates?: Array<{
      content?: {
        role?: "model" | "user";
        parts?: VertexPart[];
      };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
};
