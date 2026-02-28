import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const credentialSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expiry_date: z.number().optional(),
  token_type: z.string().optional(),
  scope: z.string().optional()
});

export type StoredCredentials = z.infer<typeof credentialSchema>;

async function readCredentialFile(path: string): Promise<StoredCredentials | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return credentialSchema.parse(parsed);
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function createCredentialStore(path: string, fallbackPath?: string) {
  const signedOutPath = `${dirname(path)}/.signed_out`;
  const fallbackDir = fallbackPath ? dirname(fallbackPath) : undefined;
  const fallbackAccountsPath = fallbackDir ? join(fallbackDir, "google_accounts.json") : undefined;

  return {
    path,
    async load(): Promise<StoredCredentials | null> {
      const primary = await readCredentialFile(path);
      if (primary) {
        return primary;
      }
      if (await exists(signedOutPath)) {
        return null;
      }
      if (!fallbackPath) {
        return null;
      }
      return readCredentialFile(fallbackPath);
    },
    async save(credentials: StoredCredentials): Promise<void> {
      const data = credentialSchema.parse(credentials);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600, encoding: "utf8" });
      await rm(signedOutPath, { force: true });
    },
    async clear(): Promise<void> {
      await rm(path, { force: true });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(signedOutPath, `${Date.now()}`, { mode: 0o600, encoding: "utf8" });
    },
    async loadFallback(): Promise<StoredCredentials | null> {
      if (!fallbackPath) {
        return null;
      }
      return readCredentialFile(fallbackPath);
    },
    async clearFallback(): Promise<void> {
      if (fallbackPath) {
        await rm(fallbackPath, { force: true });
      }
      if (fallbackAccountsPath) {
        await rm(fallbackAccountsPath, { force: true });
      }
    }
  };
}

export type CredentialStore = ReturnType<typeof createCredentialStore>;
