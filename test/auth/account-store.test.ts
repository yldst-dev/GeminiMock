import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createAccountStore } from "../../src/auth/account-store.js";

describe("account store", () => {
  it("adds multiple accounts and sets latest as active", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gca-accounts-"));
    try {
      const store = createAccountStore(join(dir, "accounts.json"));
      const first = await store.addOrUpdateAccount({
        access_token: "a1",
        refresh_token: "r1"
      }, "one@example.com");
      const second = await store.addOrUpdateAccount({
        access_token: "a2",
        refresh_token: "r2"
      }, "two@example.com");

      const list = await store.listAccounts();
      const active = await store.getActiveAccount();

      expect(list.length).toBe(2);
      expect(active?.id).toBe(second.id);
      expect(first.id).not.toBe(second.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rotates to next available account on cooldown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gca-rotate-"));
    try {
      const store = createAccountStore(join(dir, "accounts.json"));
      const first = await store.addOrUpdateAccount({
        access_token: "a1",
        refresh_token: "r1"
      }, "one@example.com");
      const second = await store.addOrUpdateAccount({
        access_token: "a2",
        refresh_token: "r2"
      }, "two@example.com");

      await store.setActiveAccount(first.id);
      const rotated = await store.rotateActiveAccount("429:generateContent", 60_000);
      const active = await store.getActiveAccount();

      expect(rotated?.id).toBe(second.id);
      expect(active?.id).toBe(second.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("logs out only the active account and switches to next", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gca-logout-active-"));
    try {
      const store = createAccountStore(join(dir, "accounts.json"));
      const first = await store.addOrUpdateAccount({
        access_token: "a1",
        refresh_token: "r1"
      }, "one@example.com");
      const second = await store.addOrUpdateAccount({
        access_token: "a2",
        refresh_token: "r2"
      }, "two@example.com");

      await store.setActiveAccount(first.id);
      const removed = await store.logoutActive();
      const list = await store.listAccounts();
      const active = await store.getActiveAccount();

      expect(removed?.id).toBe(first.id);
      expect(list.map((account) => account.id)).toEqual([second.id]);
      expect(active?.id).toBe(second.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps empty signed-in state after logging out last active account", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gca-logout-last-"));
    try {
      const accountsPath = join(dir, "accounts.json");
      const legacyPath = join(dir, "oauth.json");
      const fallbackPath = join(dir, "fallback.json");
      const store = createAccountStore(accountsPath);
      await store.addOrUpdateAccount({
        access_token: "a1",
        refresh_token: "r1"
      }, "one@example.com");
      await store.logoutActive();

      await writeFile(fallbackPath, JSON.stringify({
        access_token: "ax",
        refresh_token: "rx"
      }), "utf8");

      const reloaded = createAccountStore(accountsPath, legacyPath, fallbackPath);
      const list = await reloaded.listAccounts();
      expect(list.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates fallback once and blocks reuse after clearAll", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gca-fallback-"));
    try {
      const accountsPath = join(dir, "accounts.json");
      const legacyPath = join(dir, "oauth.json");
      const fallbackPath = join(dir, "fallback.json");
      await writeFile(fallbackPath, JSON.stringify({
        access_token: "ax",
        refresh_token: "rx"
      }), "utf8");

      const store = createAccountStore(accountsPath, legacyPath, fallbackPath);
      const migrated = await store.listAccounts();
      expect(migrated.length).toBe(1);

      await store.clearAll();

      const reloaded = await store.listAccounts();
      expect(reloaded.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
