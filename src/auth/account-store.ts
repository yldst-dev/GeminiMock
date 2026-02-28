import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { StoredCredentials } from "./credential-store.js";

const credentialSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expiry_date: z.number().optional(),
  token_type: z.string().optional(),
  scope: z.string().optional()
});

const accountSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  enabled: z.boolean().default(true),
  created_at: z.number(),
  updated_at: z.number(),
  last_used_at: z.number().optional(),
  cooldown_until: z.number().optional(),
  last_error: z.string().optional(),
  credentials: credentialSchema
});

const storageSchema = z.object({
  version: z.literal(1),
  active_account_id: z.string().optional(),
  rotation_cursor: z.number().int().nonnegative().default(0),
  accounts: z.array(accountSchema).default([])
});

type AccountStorage = z.infer<typeof storageSchema>;
export type StoredAccount = z.infer<typeof accountSchema>;

function createEmptyStorage(): AccountStorage {
  return {
    version: 1,
    active_account_id: undefined,
    rotation_cursor: 0,
    accounts: []
  };
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function normalizeCredentials(credentials: StoredCredentials): StoredCredentials {
  return credentialSchema.parse({
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token ?? undefined,
    expiry_date: credentials.expiry_date ?? undefined,
    token_type: credentials.token_type ?? undefined,
    scope: credentials.scope ?? undefined
  });
}

function now(): number {
  return Date.now();
}

function accountId(): string {
  return randomBytes(8).toString("hex");
}

function isUsable(account: StoredAccount, at: number): boolean {
  if (!account.enabled) {
    return false;
  }
  const cooldownUntil = account.cooldown_until ?? 0;
  return cooldownUntil <= at;
}

function ensureActiveAccount(storage: AccountStorage): AccountStorage {
  if (storage.accounts.length === 0) {
    storage.active_account_id = undefined;
    storage.rotation_cursor = 0;
    return storage;
  }

  const active = storage.accounts.find((account) => account.id === storage.active_account_id);
  if (active?.enabled) {
    return storage;
  }

  const fallback = storage.accounts.find((account) => account.enabled) ?? storage.accounts[0];
  storage.active_account_id = fallback?.id;
  return storage;
}

export type AccountStore = ReturnType<typeof createAccountStore>;

export function createAccountStore(
  accountsPath: string,
  legacyOAuthPath?: string,
  fallbackOAuthPath?: string
) {
  const signedOutPath = join(dirname(accountsPath), ".signed_out");
  const fallbackDir = fallbackOAuthPath ? dirname(fallbackOAuthPath) : undefined;
  const fallbackAccountsPath = fallbackDir ? join(fallbackDir, "google_accounts.json") : undefined;

  async function writeStorage(storage: AccountStorage): Promise<void> {
    const normalized = storageSchema.parse(storage);
    await mkdir(dirname(accountsPath), { recursive: true });
    await writeFile(accountsPath, JSON.stringify(normalized, null, 2), { mode: 0o600, encoding: "utf8" });
    await rm(signedOutPath, { force: true });
  }

  async function readStorageFromFile(): Promise<AccountStorage | null> {
    const raw = await readJson(accountsPath);
    if (!raw) {
      return null;
    }
    try {
      const parsed = storageSchema.parse(raw);
      return ensureActiveAccount(parsed);
    } catch {
      return null;
    }
  }

  async function signedOut(): Promise<boolean> {
    try {
      await readFile(signedOutPath, "utf8");
      return true;
    } catch {
      return false;
    }
  }

  async function migrateLegacySingleAccount(): Promise<AccountStorage> {
    const storage = createEmptyStorage();
    if (await signedOut()) {
      return storage;
    }

    const legacy = legacyOAuthPath ? await readJson(legacyOAuthPath) : null;
    const fallback = fallbackOAuthPath ? await readJson(fallbackOAuthPath) : null;
    const candidate = legacy ?? fallback;
    if (!candidate) {
      return storage;
    }

    try {
      const credentials = credentialSchema.parse(candidate);
      const initial: StoredAccount = {
        id: accountId(),
        enabled: true,
        created_at: now(),
        updated_at: now(),
        last_used_at: undefined,
        cooldown_until: undefined,
        last_error: undefined,
        email: undefined,
        credentials
      };
      storage.accounts = [initial];
      storage.active_account_id = initial.id;
      storage.rotation_cursor = 0;
      await writeStorage(storage);
      return storage;
    } catch {
      return storage;
    }
  }

  async function loadStorage(): Promise<AccountStorage> {
    const existing = await readStorageFromFile();
    if (existing) {
      return ensureActiveAccount(existing);
    }
    return migrateLegacySingleAccount();
  }

  function resolveAccount(accounts: StoredAccount[], idOrEmail: string): StoredAccount | undefined {
    const key = idOrEmail.trim().toLowerCase();
    return accounts.find((account) => account.id === idOrEmail || account.email?.toLowerCase() === key);
  }

  function upsertAccount(
    storage: AccountStorage,
    credentials: StoredCredentials,
    email?: string
  ): StoredAccount {
    const normalized = normalizeCredentials(credentials);
    const emailKey = email?.trim().toLowerCase();
    const refreshToken = normalized.refresh_token;

    const existing = storage.accounts.find((account) => {
      if (refreshToken && account.credentials.refresh_token === refreshToken) {
        return true;
      }
      if (emailKey && account.email?.toLowerCase() === emailKey) {
        return true;
      }
      return false;
    });

    if (existing) {
      existing.credentials = normalizeCredentials({
        ...normalized,
        refresh_token: normalized.refresh_token ?? existing.credentials.refresh_token,
        expiry_date: normalized.expiry_date ?? existing.credentials.expiry_date
      });
      existing.enabled = true;
      existing.updated_at = now();
      existing.cooldown_until = undefined;
      existing.last_error = undefined;
      if (email) {
        existing.email = email;
      }
      storage.active_account_id = existing.id;
      return existing;
    }

    const created: StoredAccount = {
      id: accountId(),
      email: email,
      enabled: true,
      created_at: now(),
      updated_at: now(),
      last_used_at: undefined,
      cooldown_until: undefined,
      last_error: undefined,
      credentials: normalized
    };
    storage.accounts.push(created);
    storage.active_account_id = created.id;
    return created;
  }

  return {
    accountsPath,
    async listAccounts(): Promise<StoredAccount[]> {
      const storage = await loadStorage();
      return storage.accounts.map((account) => ({ ...account }));
    },
    async getActiveAccount(): Promise<StoredAccount | null> {
      const storage = await loadStorage();
      const active = storage.accounts.find((account) => account.id === storage.active_account_id);
      return active ? { ...active } : null;
    },
    async getAccountCount(): Promise<number> {
      const storage = await loadStorage();
      return storage.accounts.filter((account) => account.enabled).length;
    },
    async addOrUpdateAccount(credentials: StoredCredentials, email?: string): Promise<StoredAccount> {
      const storage = await loadStorage();
      const account = upsertAccount(storage, credentials, email);
      await writeStorage(storage);
      return { ...account };
    },
    async setActiveAccount(idOrEmail: string): Promise<StoredAccount> {
      const storage = await loadStorage();
      const account = resolveAccount(storage.accounts, idOrEmail);
      if (!account) {
        throw new Error(`Account not found: ${idOrEmail}`);
      }
      if (!account.enabled) {
        throw new Error(`Account is disabled: ${idOrEmail}`);
      }
      storage.active_account_id = account.id;
      account.updated_at = now();
      await writeStorage(storage);
      return { ...account };
    },
    async removeAccount(idOrEmail: string): Promise<boolean> {
      const storage = await loadStorage();
      const index = storage.accounts.findIndex((account) => {
        const email = account.email?.toLowerCase();
        const key = idOrEmail.trim().toLowerCase();
        return account.id === idOrEmail || email === key;
      });
      if (index < 0) {
        return false;
      }
      const removed = storage.accounts.splice(index, 1)[0];
      if (removed?.id === storage.active_account_id) {
        storage.active_account_id = storage.accounts.find((account) => account.enabled)?.id
          ?? storage.accounts[0]?.id;
      }
      await writeStorage(storage);
      return true;
    },
    async logoutActive(): Promise<StoredAccount | null> {
      const storage = await loadStorage();
      const index = storage.accounts.findIndex((account) => account.id === storage.active_account_id);
      if (index < 0) {
        return null;
      }
      const removed = storage.accounts.splice(index, 1)[0];
      if (removed?.id === storage.active_account_id) {
        storage.active_account_id = storage.accounts.find((account) => account.enabled)?.id
          ?? storage.accounts[0]?.id;
      }
      if (storage.accounts.length === 0) {
        storage.rotation_cursor = 0;
      } else if (storage.rotation_cursor >= storage.accounts.length) {
        storage.rotation_cursor = 0;
      }
      await writeStorage(storage);
      return removed ? { ...removed } : null;
    },
    async markActiveUsed(): Promise<void> {
      const storage = await loadStorage();
      const active = storage.accounts.find((account) => account.id === storage.active_account_id);
      if (!active) {
        return;
      }
      active.last_used_at = now();
      active.updated_at = now();
      active.cooldown_until = undefined;
      active.last_error = undefined;
      await writeStorage(storage);
    },
    async updateActiveCredentials(credentials: StoredCredentials, email?: string): Promise<StoredAccount> {
      const storage = await loadStorage();
      let active = storage.accounts.find((account) => account.id === storage.active_account_id);
      if (!active) {
        active = upsertAccount(storage, credentials, email);
      } else {
        const normalized = normalizeCredentials(credentials);
        active.credentials = normalizeCredentials({
          ...normalized,
          refresh_token: normalized.refresh_token ?? active.credentials.refresh_token,
          expiry_date: normalized.expiry_date ?? active.credentials.expiry_date
        });
        active.updated_at = now();
        active.cooldown_until = undefined;
        active.last_error = undefined;
        if (email) {
          active.email = email;
        }
      }
      await writeStorage(storage);
      return { ...active };
    },
    async rotateActiveAccount(reason: string, cooldownMs: number): Promise<StoredAccount | null> {
      const storage = await loadStorage();
      if (storage.accounts.length < 2) {
        return null;
      }

      const at = now();
      const activeIndex = storage.accounts.findIndex((account) => account.id === storage.active_account_id);
      const current = activeIndex >= 0 ? storage.accounts[activeIndex] : undefined;
      if (!current) {
        storage.active_account_id = storage.accounts.find((account) => isUsable(account, at))?.id
          ?? storage.accounts[0]?.id;
        await writeStorage(storage);
        return storage.accounts.find((account) => account.id === storage.active_account_id) ?? null;
      }

      current.cooldown_until = at + Math.max(0, cooldownMs);
      current.last_error = reason;
      current.updated_at = at;

      for (let step = 1; step <= storage.accounts.length; step += 1) {
        const idx = (activeIndex + step) % storage.accounts.length;
        const candidate = storage.accounts[idx];
        if (!candidate) {
          continue;
        }
        if (candidate.id === current.id) {
          continue;
        }
        if (!isUsable(candidate, at)) {
          continue;
        }
        storage.active_account_id = candidate.id;
        storage.rotation_cursor = idx;
        candidate.last_used_at = at;
        candidate.updated_at = at;
        await writeStorage(storage);
        return { ...candidate };
      }

      await writeStorage(storage);
      return null;
    },
    async clearAll(): Promise<void> {
      await rm(accountsPath, { force: true });
      await mkdir(dirname(accountsPath), { recursive: true });
      await writeFile(signedOutPath, `${Date.now()}`, { mode: 0o600, encoding: "utf8" });
      if (legacyOAuthPath) {
        await rm(legacyOAuthPath, { force: true });
      }
      if (fallbackOAuthPath) {
        await rm(fallbackOAuthPath, { force: true });
      }
      if (fallbackAccountsPath) {
        await rm(fallbackAccountsPath, { force: true });
      }
    }
  };
}
