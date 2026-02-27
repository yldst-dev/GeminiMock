import { describe, expect, it, vi } from "vitest";
import { performSelfUpdate } from "../../src/update/self-update.js";

describe("performSelfUpdate", () => {
  it("does not install when already up to date", async () => {
    const installLatest = vi.fn(async () => undefined);
    const write = vi.fn();

    const result = await performSelfUpdate("geminimock", {
      getCurrentVersion: async () => "0.1.1",
      getLatestVersion: async () => "0.1.1",
      installLatest,
      write
    });

    expect(result.updated).toBe(false);
    expect(installLatest).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith("geminimock is already up to date (0.1.1).\n");
  });

  it("installs latest when update is available", async () => {
    const installLatest = vi.fn(async () => undefined);
    const write = vi.fn();

    const result = await performSelfUpdate("geminimock", {
      getCurrentVersion: async () => "0.1.0",
      getLatestVersion: async () => "0.1.1",
      installLatest,
      write
    });

    expect(result.updated).toBe(true);
    expect(installLatest).toHaveBeenCalledWith("geminimock");
    expect(write).toHaveBeenCalledWith("Updating geminimock from 0.1.0 to 0.1.1...\n");
    expect(write).toHaveBeenCalledWith("Update completed.\n");
  });

  it("continues with install when latest version lookup fails", async () => {
    const installLatest = vi.fn(async () => undefined);
    const write = vi.fn();

    const result = await performSelfUpdate("geminimock", {
      getCurrentVersion: async () => "0.1.0",
      getLatestVersion: async () => {
        throw new Error("network error");
      },
      installLatest,
      write
    });

    expect(result.updated).toBe(true);
    expect(installLatest).toHaveBeenCalledWith("geminimock");
    expect(write).toHaveBeenCalledWith("Could not check latest version. Proceeding with update.\n");
    expect(write).toHaveBeenCalledWith("Updating geminimock to latest...\n");
  });
});

