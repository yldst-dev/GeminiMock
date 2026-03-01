import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { OAuth2Client, CodeChallengeMethod, type Credentials } from "google-auth-library";

const GEMINI_OAUTH_SOURCE_RELATIVE_PATHS = [
  "node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js",
  "lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js",
  "@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js",
  "@google/gemini-cli-core/dist/src/code_assist/oauth2.js"
] as const;

export const GEMINI_CLI_OAUTH_REDIRECT_URI = "https://codeassist.google.com/authcode";
export const GEMINI_CLI_OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
] as const;
const GEMINI_CLI_OAUTH_PROMPT = "consent select_account";
const BUILTIN_GEMINI_OAUTH_CLIENT_ID =
  "1073289179617-f9lhe1dk1lceh0ohl3p00qvvk34l4n93.apps.googleusercontent.com";
const BUILTIN_GEMINI_OAUTH_CLIENT_SECRET = "d-FL95Q19V0wGuN-3sK6Hjeu";

type OAuthClientConfig = {
  clientId: string;
  clientSecret?: string;
};

let discoveredClientConfig: OAuthClientConfig | null | undefined;

export type ManualOAuthRequest = {
  authUrl: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
};

export type WebOAuthRequest = {
  authUrl: string;
  state: string;
  redirectUri: string;
};

export type ParsedOAuthInput = {
  code: string;
  state?: string;
};

function readConfigFromSourceFile(filePath: string): OAuthClientConfig | null {
  if (!existsSync(filePath)) {
    return null;
  }

  let source = "";
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const idMatch = source.match(/const OAUTH_CLIENT_ID = ['"]([^'"]+)['"]/);
  if (!idMatch?.[1]) {
    return null;
  }
  const secretMatch = source.match(/const OAUTH_CLIENT_SECRET = ['"]([^'"]+)['"]/);
  return {
    clientId: idMatch[1],
    clientSecret: secretMatch?.[1]
  };
}

function findConfigInDirectory(baseDir: string): OAuthClientConfig | null {
  for (const relativePath of GEMINI_OAUTH_SOURCE_RELATIVE_PATHS) {
    const config = readConfigFromSourceFile(path.join(baseDir, relativePath));
    if (config) {
      return config;
    }
  }
  return null;
}

function isExecutableFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  if (process.platform === "win32") {
    return true;
  }
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveGeminiBinaryPath(): string | null {
  const configuredPath = process.env.GEMINI_CLI_BIN_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const pathValue = process.env.PATH;
  if (!pathValue) {
    return null;
  }

  const searchPaths = pathValue.split(path.delimiter).filter(Boolean);
  const executableNames = process.platform === "win32"
    ? (process.env.PATHEXT?.split(";").filter(Boolean) ?? [".exe", ".cmd", ".bat"]).map(
        (ext) => `gemini${ext}`
      )
    : ["gemini"];

  for (const searchPath of searchPaths) {
    for (const executableName of executableNames) {
      const candidate = path.join(searchPath, executableName);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function discoverFromGeminiBinary(): OAuthClientConfig | null {
  const binaryPath = resolveGeminiBinaryPath();
  if (!binaryPath) {
    return null;
  }

  let resolved = binaryPath;
  try {
    resolved = realpathSync(binaryPath);
  } catch {}

  let current = path.dirname(resolved);
  for (let i = 0; i < 10; i += 1) {
    const config = findConfigInDirectory(current);
    if (config) {
      return config;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function discoverFromGlobalNpmRoot(): OAuthClientConfig | null {
  try {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    if (!root) {
      return null;
    }
    return findConfigInDirectory(root);
  } catch {
    return null;
  }
}

function discoverDefaultClientConfig(): OAuthClientConfig | null {
  if (process.env.GEMINI_CLI_OAUTH_AUTO_DISCOVERY === "0") {
    return null;
  }
  if (discoveredClientConfig !== undefined) {
    return discoveredClientConfig;
  }

  const sourcePath = process.env.GEMINI_CLI_OAUTH_SOURCE_PATH?.trim();
  if (sourcePath) {
    discoveredClientConfig = readConfigFromSourceFile(sourcePath);
    return discoveredClientConfig;
  }

  discoveredClientConfig = discoverFromGeminiBinary() ?? discoverFromGlobalNpmRoot() ?? null;
  return discoveredClientConfig;
}

function resolveClientId(): string | undefined {
  const envClientId = process.env.GEMINI_CLI_OAUTH_CLIENT_ID?.trim();
  if (envClientId) {
    return envClientId;
  }
  return discoverDefaultClientConfig()?.clientId ?? BUILTIN_GEMINI_OAUTH_CLIENT_ID;
}

function resolveClientSecret(): string | undefined {
  const envClientSecret = process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET?.trim();
  if (envClientSecret) {
    return envClientSecret;
  }
  return discoverDefaultClientConfig()?.clientSecret ?? BUILTIN_GEMINI_OAUTH_CLIENT_SECRET;
}

export function hasConfiguredOAuthClient(): boolean {
  return Boolean(resolveClientId());
}

export function createOAuthClient(): OAuth2Client {
  const clientId = resolveClientId();
  if (!clientId) {
    throw new Error(
      "OAuth client is not configured. Set GEMINI_CLI_OAUTH_CLIENT_ID or install Gemini CLI."
    );
  }
  return new OAuth2Client({
    clientId,
    clientSecret: resolveClientSecret()
  });
}

export async function buildManualOAuthRequest(): Promise<ManualOAuthRequest> {
  const client = createOAuthClient();
  const verifier = await client.generateCodeVerifierAsync();
  const state = randomBytes(32).toString("hex");
  const authUrl = client.generateAuthUrl({
    redirect_uri: GEMINI_CLI_OAUTH_REDIRECT_URI,
    access_type: "offline",
    prompt: GEMINI_CLI_OAUTH_PROMPT,
    scope: [...GEMINI_CLI_OAUTH_SCOPE],
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: verifier.codeChallenge,
    state
  });
  return {
    authUrl,
    codeVerifier: verifier.codeVerifier,
    state,
    redirectUri: GEMINI_CLI_OAUTH_REDIRECT_URI
  };
}

export function buildWebOAuthRequest(port: number): WebOAuthRequest {
  const client = createOAuthClient();
  const state = randomBytes(32).toString("hex");
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const authUrl = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: "offline",
    prompt: GEMINI_CLI_OAUTH_PROMPT,
    scope: [...GEMINI_CLI_OAUTH_SCOPE],
    state
  });
  return { authUrl, state, redirectUri };
}

export function parseOAuthInput(input: string): ParsedOAuthInput {
  const value = input.trim();
  if (!value) {
    throw new Error("Authorization code is required");
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    const url = new URL(value);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? undefined;
    if (!code) {
      throw new Error("Callback URL does not include code parameter");
    }
    return { code, state };
  }

  return { code: value };
}

export async function exchangeManualCode(request: ManualOAuthRequest, code: string): Promise<Credentials> {
  const parsed = parseOAuthInput(code);
  if (parsed.state && parsed.state !== request.state) {
    throw new Error("OAuth state mismatch");
  }
  const client = createOAuthClient();
  const tokenResponse = await client.getToken({
    code: parsed.code,
    codeVerifier: request.codeVerifier,
    redirect_uri: request.redirectUri
  });
  return tokenResponse.tokens;
}

export async function exchangeWebCode(request: WebOAuthRequest, code: string): Promise<Credentials> {
  const client = createOAuthClient();
  const tokenResponse = await client.getToken({
    code,
    redirect_uri: request.redirectUri
  });
  return tokenResponse.tokens;
}
