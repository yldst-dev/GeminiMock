import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { loadEnv, type AppEnv } from "../config/env.js";

type FileOps = {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  rm(path: string): Promise<void>;
};

type BackgroundServiceDeps = {
  fileOps?: FileOps;
  loadEnv?: () => AppEnv;
  execPath?: string;
  entryPath?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  spawnProcess?: (command: string, args: string[], logPath: string, env: NodeJS.ProcessEnv) => number;
  isProcessAlive?: (pid: number) => boolean;
  killProcess?: (pid: number, signal?: NodeJS.Signals) => void;
  fetchFn?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  resolveAvailablePort?: (host: string, preferredPort: number) => Promise<number>;
};

export type BackgroundStartResult = {
  alreadyRunning: boolean;
  pid?: number;
  port: number;
  url: string;
  logPath: string;
};

export type BackgroundStatusResult = {
  running: boolean;
  pid?: number;
  port: number;
  url: string;
  logPath: string;
};

export type BackgroundStopResult = {
  stopped: boolean;
  pid?: number;
  unmanagedRunning?: boolean;
};

function defaultFileOps(): FileOps {
  return {
    async mkdir(path: string) {
      await mkdir(path, { recursive: true });
    },
    async readFile(path: string) {
      return readFile(path, "utf8");
    },
    async writeFile(path: string, data: string) {
      await writeFile(path, data, { encoding: "utf8", mode: 0o600 });
    },
    async rm(path: string) {
      await rm(path, { force: true });
    }
  };
}

function defaultSpawnProcess(command: string, args: string[], logPath: string, env: NodeJS.ProcessEnv): number {
  const fd = openSync(logPath, "a");
  const child = spawn(command, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
    env
  });
  closeSync(fd);
  if (!child.pid) {
    throw new Error("Failed to start background process");
  }
  child.unref();
  return child.pid;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parsePid(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function parsePort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    return null;
  }
  return value;
}

async function readPid(fileOps: FileOps, pidPath: string): Promise<number | null> {
  try {
    const raw = await fileOps.readFile(pidPath);
    return parsePid(raw);
  } catch {
    return null;
  }
}

async function readPort(fileOps: FileOps, portPath: string): Promise<number | null> {
  try {
    const raw = await fileOps.readFile(portPath);
    return parsePort(raw);
  } catch {
    return null;
  }
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = net.createServer();
    server.once("error", () => resolvePromise(false));
    server.listen(port, host, () => {
      server.close(() => resolvePromise(true));
    });
  });
}

async function findEphemeralPort(host: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once("error", (error) => reject(error));
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate ephemeral port")));
        return;
      }
      const port = address.port;
      server.close(() => resolvePromise(port));
    });
  });
}

async function resolveAvailablePortDefault(host: string, preferredPort: number): Promise<number> {
  if (await isPortAvailable(host, preferredPort)) {
    return preferredPort;
  }
  return findEphemeralPort(host);
}

async function isHealthyWithTimeout(fetchFn: typeof fetch, url: string): Promise<boolean> {
  try {
    const response = await fetchFn(`${url}/health`, {
      signal: AbortSignal.timeout(1_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function createBackgroundServiceManager(deps: BackgroundServiceDeps = {}) {
  const fileOps = deps.fileOps ?? defaultFileOps();
  const readEnv = deps.loadEnv ?? loadEnv;
  const execPath = deps.execPath ?? process.execPath;
  const entryPath = resolve(deps.entryPath ?? process.argv[1] ?? "");
  const stateDir = deps.stateDir ?? join(homedir(), ".geminimock");
  const runtimeEnv = deps.env ?? process.env;
  const spawnProcess = deps.spawnProcess ?? defaultSpawnProcess;
  const isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
  const killProcess = deps.killProcess ?? process.kill;
  const fetchFn = deps.fetchFn ?? fetch;
  const wait = deps.wait ?? sleep;
  const resolveAvailablePort = deps.resolveAvailablePort ?? resolveAvailablePortDefault;
  const env = readEnv();
  const host = env.host;
  const defaultPort = env.port;
  const pidPath = join(stateDir, "server.pid");
  const portPath = join(stateDir, "server.port");
  const logPath = join(stateDir, "server.log");

  function buildUrl(port: number): string {
    return `http://${host}:${port}`;
  }

  async function waitUntilHealthy(pid: number, url: string): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (!isProcessAlive(pid)) {
        throw new Error(`Background server exited during startup. Check log: ${logPath}`);
      }
      const healthy = await isHealthyWithTimeout(fetchFn, url);
      if (healthy) {
        if (!isProcessAlive(pid)) {
          throw new Error(`Port is already in use by another process. Check log: ${logPath}`);
        }
        return;
      }
      await wait(300);
    }
    throw new Error(`Background server did not become healthy in time. Check log: ${logPath}`);
  }

  async function isHealthyEndpointAvailable(url: string): Promise<boolean> {
    return isHealthyWithTimeout(fetchFn, url);
  }

  async function start(): Promise<BackgroundStartResult> {
    await fileOps.mkdir(stateDir);
    const existingPid = await readPid(fileOps, pidPath);
    const storedPort = await readPort(fileOps, portPath);
    const activePort = storedPort ?? defaultPort;
    const activeUrl = buildUrl(activePort);
    if (existingPid && isProcessAlive(existingPid)) {
      return {
        alreadyRunning: true,
        pid: existingPid,
        port: activePort,
        url: activeUrl,
        logPath
      };
    }
    if (existingPid) {
      await fileOps.rm(pidPath);
    }

    if (await isHealthyEndpointAvailable(activeUrl)) {
      return {
        alreadyRunning: true,
        port: activePort,
        url: activeUrl,
        logPath
      };
    }

    const selectedPort = await resolveAvailablePort(host, defaultPort);
    const selectedUrl = buildUrl(selectedPort);
    const childEnv: NodeJS.ProcessEnv = {
      ...runtimeEnv,
      GEMINI_CLI_API_HOST: host,
      GEMINI_CLI_API_PORT: String(selectedPort)
    };

    const pid = spawnProcess(execPath, [entryPath, "serve"], logPath, childEnv);
    await fileOps.writeFile(pidPath, `${pid}\n`);
    await fileOps.writeFile(portPath, `${selectedPort}\n`);

    try {
      await waitUntilHealthy(pid, selectedUrl);
    } catch (error) {
      if (isProcessAlive(pid)) {
        try {
          killProcess(pid, "SIGTERM");
        } catch {
        }
      }
      await fileOps.rm(pidPath);
      await fileOps.rm(portPath);
      throw error;
    }

    return {
      alreadyRunning: false,
      pid,
      port: selectedPort,
      url: selectedUrl,
      logPath
    };
  }

  async function stop(): Promise<BackgroundStopResult> {
    const pid = await readPid(fileOps, pidPath);
    const storedPort = await readPort(fileOps, portPath);
    const activePort = storedPort ?? defaultPort;
    const activeUrl = buildUrl(activePort);
    if (!pid) {
      if (await isHealthyEndpointAvailable(activeUrl)) {
        return { stopped: false, unmanagedRunning: true };
      }
      return { stopped: false };
    }

    if (!isProcessAlive(pid)) {
      await fileOps.rm(pidPath);
      await fileOps.rm(portPath);
      if (await isHealthyEndpointAvailable(activeUrl)) {
        return { stopped: false, pid, unmanagedRunning: true };
      }
      return { stopped: false, pid };
    }

    try {
      killProcess(pid, "SIGTERM");
    } catch {
    }

    for (let i = 0; i < 20; i += 1) {
      if (!isProcessAlive(pid)) {
        await fileOps.rm(pidPath);
        await fileOps.rm(portPath);
        return { stopped: true, pid };
      }
      await wait(200);
    }

    try {
      killProcess(pid, "SIGKILL");
    } catch {
    }

    for (let i = 0; i < 10; i += 1) {
      if (!isProcessAlive(pid)) {
        await fileOps.rm(pidPath);
        await fileOps.rm(portPath);
        return { stopped: true, pid };
      }
      await wait(200);
    }

    throw new Error(`Failed to stop background server process ${pid}`);
  }

  async function status(): Promise<BackgroundStatusResult> {
    const pid = await readPid(fileOps, pidPath);
    const storedPort = await readPort(fileOps, portPath);
    const activePort = storedPort ?? defaultPort;
    const activeUrl = buildUrl(activePort);
    if (!pid) {
      if (await isHealthyEndpointAvailable(activeUrl)) {
        return {
          running: true,
          port: activePort,
          url: activeUrl,
          logPath
        };
      }
      return {
        running: false,
        port: activePort,
        url: activeUrl,
        logPath
      };
    }

    if (!isProcessAlive(pid)) {
      await fileOps.rm(pidPath);
      await fileOps.rm(portPath);
      if (await isHealthyEndpointAvailable(activeUrl)) {
        return {
          running: true,
          port: activePort,
          url: activeUrl,
          logPath
        };
      }
      return {
        running: false,
        port: activePort,
        url: activeUrl,
        logPath
      };
    }

    return {
      running: true,
      pid,
      port: activePort,
      url: activeUrl,
      logPath
    };
  }

  return {
    start,
    stop,
    status
  };
}
