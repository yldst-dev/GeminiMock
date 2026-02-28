import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createCredentialStore, type StoredCredentials } from "../../src/auth/credential-store.js";

describe("credential store", () => {
  it("saves and loads credentials", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gca-store-"));
    try {
      const path = join(dir, "oauth.json");
      const store = createCredentialStore(path);
      const creds: StoredCredentials = {
        access_token: "access",
        refresh_token: "refresh",
        expiry_date: Date.now() + 100000,
        token_type: "Bearer",
        scope: "scope"
      };
      await store.save(creds);
      const loaded = await store.load();
      expect(loaded).toEqual(creds);
      const raw = await readFile(path, "utf8");
      expect(raw.includes("refresh")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads from fallback when primary does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gca-store-"));
    try {
      const primary = join(dir, "primary.json");
      const fallback = join(dir, "fallback.json");
      const fallbackStore = createCredentialStore(fallback);
      await fallbackStore.save({
        access_token: "a",
        refresh_token: "r"
      });
      const store = createCredentialStore(primary, fallback);
      const loaded = await store.load();
      expect(loaded?.refresh_token).toBe("r");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not load fallback after clear", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gca-store-"));
    try {
      const primary = join(dir, "primary.json");
      const fallback = join(dir, "fallback.json");
      const fallbackStore = createCredentialStore(fallback);
      await fallbackStore.save({
        access_token: "a",
        refresh_token: "r"
      });
      const store = createCredentialStore(primary, fallback);
      await store.clear();
      const loaded = await store.load();
      expect(loaded).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

});
