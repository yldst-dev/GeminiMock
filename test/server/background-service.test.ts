import { describe, expect, it, vi } from "vitest";
import { createBackgroundServiceManager } from "../../src/server/background-service.js";

type MemoryFs = {
  files: Map<string, string>;
  fileOps: {
    mkdir(path: string): Promise<void>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
    rm(path: string): Promise<void>;
  };
};

function createMemoryFs(initial: Record<string, string> = {}): MemoryFs {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    fileOps: {
      async mkdir() {
      },
      async readFile(path: string) {
        if (!files.has(path)) {
          throw new Error("ENOENT");
        }
        return files.get(path) ?? "";
      },
      async writeFile(path: string, data: string) {
        files.set(path, data);
      },
      async rm(path: string) {
        files.delete(path);
      }
    }
  };
}

function mockEnv() {
  return {
    host: "127.0.0.1",
    port: 43173,
    defaultModel: "gemini-2.5-pro",
    codeAssistEndpoint: "https://cloudcode-pa.googleapis.com",
    codeAssistApiVersion: "v1internal",
    accountsPath: "/tmp/accounts.json",
    oauthPath: "/tmp/oauth.json",
    oauthFallbackPath: "/tmp/fallback.json"
  };
}

describe("background service manager", () => {
  it("returns already running when PID file points to live process", async () => {
    const stateDir = "/tmp/geminimock";
    const pidPath = `${stateDir}/server.pid`;
    const { fileOps } = createMemoryFs({ [pidPath]: "123\n" });
    const spawnProcess = vi.fn(() => 777);

    const manager = createBackgroundServiceManager({
      stateDir,
      fileOps,
      loadEnv: mockEnv,
      spawnProcess,
      isProcessAlive: (pid) => pid === 123,
      fetchFn: vi.fn(async () => new Response("", { status: 200 })),
      wait: async () => undefined
    });

    const result = await manager.start();

    expect(result.alreadyRunning).toBe(true);
    expect(result.pid).toBe(123);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("starts server, stores pid, and reports running", async () => {
    const stateDir = "/tmp/geminimock";
    const pidPath = `${stateDir}/server.pid`;
    const portPath = `${stateDir}/server.port`;
    const { fileOps, files } = createMemoryFs();
    const alive = new Set<number>();

    const manager = createBackgroundServiceManager({
      stateDir,
      fileOps,
      loadEnv: mockEnv,
      spawnProcess: () => {
        alive.add(555);
        return 555;
      },
      resolveAvailablePort: async () => 55001,
      isProcessAlive: (pid) => alive.has(pid),
      killProcess: (pid) => {
        alive.delete(pid);
      },
      fetchFn: vi.fn(async () => new Response("", { status: alive.size > 0 ? 200 : 503 })),
      wait: async () => undefined
    });

    const result = await manager.start();

    expect(result.alreadyRunning).toBe(false);
    expect(result.pid).toBe(555);
    expect(result.port).toBe(55001);
    expect(files.get(pidPath)).toBe("555\n");
    expect(files.get(portPath)).toBe("55001\n");
  });

  it("treats healthy endpoint without pid file as already running", async () => {
    const stateDir = "/tmp/geminimock";
    const { fileOps } = createMemoryFs();
    const spawnProcess = vi.fn(() => 888);

    const manager = createBackgroundServiceManager({
      stateDir,
      fileOps,
      loadEnv: mockEnv,
      spawnProcess,
      isProcessAlive: () => false,
      fetchFn: vi.fn(async () => new Response("", { status: 200 })),
      wait: async () => undefined
    });

    const result = await manager.start();

    expect(result.alreadyRunning).toBe(true);
    expect(result.pid).toBeUndefined();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("stops running server and clears pid file", async () => {
    const stateDir = "/tmp/geminimock";
    const pidPath = `${stateDir}/server.pid`;
    const { fileOps, files } = createMemoryFs({ [pidPath]: "444\n" });
    const alive = new Set<number>([444]);

    const manager = createBackgroundServiceManager({
      stateDir,
      fileOps,
      loadEnv: mockEnv,
      isProcessAlive: (pid) => alive.has(pid),
      killProcess: (pid) => {
        alive.delete(pid);
      },
      fetchFn: vi.fn(async () => new Response("", { status: 200 })),
      wait: async () => undefined
    });

    const result = await manager.stop();

    expect(result.stopped).toBe(true);
    expect(result.pid).toBe(444);
    expect(files.has(pidPath)).toBe(false);
  });

  it("cleans stale pid when process is not alive", async () => {
    const stateDir = "/tmp/geminimock";
    const pidPath = `${stateDir}/server.pid`;
    const { fileOps, files } = createMemoryFs({ [pidPath]: "999\n" });

    const manager = createBackgroundServiceManager({
      stateDir,
      fileOps,
      loadEnv: mockEnv,
      isProcessAlive: () => false,
      fetchFn: vi.fn(async () => new Response("", { status: 503 })),
      wait: async () => undefined
    });

    const status = await manager.status();

    expect(status.running).toBe(false);
    expect(files.has(pidPath)).toBe(false);
  });

  it("reports unmanaged running status when endpoint is healthy without pid", async () => {
    const stateDir = "/tmp/geminimock";
    const { fileOps } = createMemoryFs();

    const manager = createBackgroundServiceManager({
      stateDir,
      fileOps,
      loadEnv: mockEnv,
      isProcessAlive: () => false,
      fetchFn: vi.fn(async () => new Response("", { status: 200 })),
      wait: async () => undefined
    });

    const status = await manager.status();
    const stop = await manager.stop();

    expect(status.running).toBe(true);
    expect(status.pid).toBeUndefined();
    expect(stop.stopped).toBe(false);
    expect(stop.unmanagedRunning).toBe(true);
  });

  it("uses stored port for status and stop operations", async () => {
    const stateDir = "/tmp/geminimock";
    const pidPath = `${stateDir}/server.pid`;
    const portPath = `${stateDir}/server.port`;
    const { fileOps, files } = createMemoryFs({
      [pidPath]: "222\n",
      [portPath]: "55123\n"
    });
    const alive = new Set<number>([222]);

    const manager = createBackgroundServiceManager({
      stateDir,
      fileOps,
      loadEnv: mockEnv,
      isProcessAlive: (pid) => alive.has(pid),
      killProcess: (pid) => {
        alive.delete(pid);
      },
      fetchFn: vi.fn(async () => new Response("", { status: 200 })),
      wait: async () => undefined
    });

    const status = await manager.status();
    const stop = await manager.stop();

    expect(status.running).toBe(true);
    expect(status.port).toBe(55123);
    expect(status.url).toBe("http://127.0.0.1:55123");
    expect(stop.stopped).toBe(true);
    expect(files.has(pidPath)).toBe(false);
    expect(files.has(portPath)).toBe(false);
  });
});
