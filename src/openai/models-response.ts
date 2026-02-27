export type OpenAIModelListResponse = {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
  }>;
};

export function toOpenAIModelList(models: string[]): OpenAIModelListResponse {
  return {
    object: "list",
    data: models.map((model) => ({
      id: model,
      object: "model",
      created: 0,
      owned_by: "google-code-assist"
    }))
  };
}
