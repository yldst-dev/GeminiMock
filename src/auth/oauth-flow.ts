import { randomBytes } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client, type Credentials } from "google-auth-library";

export const GEMINI_CLI_OAUTH_CLIENT_ID = process.env.GEMINI_CLI_OAUTH_CLIENT_ID ?? "replace-with-google-oauth-client-id";
export const GEMINI_CLI_OAUTH_CLIENT_SECRET = process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET ?? "replace-with-google-oauth-client-secret";
export const GEMINI_CLI_OAUTH_REDIRECT_URI = "https://codeassist.google.com/authcode";
export const GEMINI_CLI_OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
] as const;

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

export function createOAuthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: GEMINI_CLI_OAUTH_CLIENT_ID,
    clientSecret: GEMINI_CLI_OAUTH_CLIENT_SECRET
  });
}

export async function buildManualOAuthRequest(): Promise<ManualOAuthRequest> {
  const client = createOAuthClient();
  const verifier = await client.generateCodeVerifierAsync();
  const state = randomBytes(32).toString("hex");
  const authUrl = client.generateAuthUrl({
    redirect_uri: GEMINI_CLI_OAUTH_REDIRECT_URI,
    access_type: "offline",
    prompt: "consent",
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
    prompt: "consent",
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
