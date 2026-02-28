import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const schema = z.object({
  GEMINI_CLI_API_HOST: z.string().default("127.0.0.1"),
  GEMINI_CLI_API_PORT: z.coerce.number().int().min(1).max(65535).default(43173),
  GEMINI_CLI_MODEL: z.string().default("gemini-2.5-pro"),
  CODE_ASSIST_ENDPOINT: z.string().url().default("https://cloudcode-pa.googleapis.com"),
  CODE_ASSIST_API_VERSION: z.string().default("v1internal"),
  GEMINI_CLI_API_ACCOUNTS_PATH: z.string().default(join(homedir(), ".geminimock", "accounts.json")),
  GEMINI_CLI_API_OAUTH_PATH: z.string().default(join(homedir(), ".geminimock", "oauth_creds.json")),
  GEMINI_CLI_OAUTH_FALLBACK_PATH: z.string().default(join(homedir(), ".gemini", "oauth_creds.json")),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_CLOUD_PROJECT_ID: z.string().optional()
});

export type AppEnv = {
  host: string;
  port: number;
  defaultModel: string;
  codeAssistEndpoint: string;
  codeAssistApiVersion: string;
  accountsPath: string;
  oauthPath: string;
  oauthFallbackPath: string;
  projectId?: string;
};

export function loadEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): AppEnv {
  const parsed = schema.parse(source);
  return {
    host: parsed.GEMINI_CLI_API_HOST,
    port: parsed.GEMINI_CLI_API_PORT,
    defaultModel: parsed.GEMINI_CLI_MODEL,
    codeAssistEndpoint: parsed.CODE_ASSIST_ENDPOINT,
    codeAssistApiVersion: parsed.CODE_ASSIST_API_VERSION,
    accountsPath: parsed.GEMINI_CLI_API_ACCOUNTS_PATH,
    oauthPath: parsed.GEMINI_CLI_API_OAUTH_PATH,
    oauthFallbackPath: parsed.GEMINI_CLI_OAUTH_FALLBACK_PATH,
    projectId: parsed.GOOGLE_CLOUD_PROJECT ?? parsed.GOOGLE_CLOUD_PROJECT_ID
  };
}
