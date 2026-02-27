import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type UpdateDependencies = {
  getCurrentVersion?: () => Promise<string | undefined>;
  getLatestVersion?: (packageName: string) => Promise<string | undefined>;
  installLatest?: (packageName: string) => Promise<void>;
  write?: (message: string) => void;
};

export type SelfUpdateResult = {
  updated: boolean;
  currentVersion?: string;
  latestVersion?: string;
};

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function normalizeVersion(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") {
      return parsed.trim();
    }
    if (parsed && typeof parsed === "object") {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string") {
        return version.trim();
      }
    }
  } catch {
    return trimmed.replace(/^"+|"+$/g, "");
  }

  return undefined;
}

function runCommand(command: string, args: string[], inherit = false): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    if (!inherit) {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

async function getCurrentVersion(): Promise<string | undefined> {
  const packageJsonPath = new URL("../../package.json", import.meta.url);
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version?.trim();
}

async function getLatestVersion(packageName: string): Promise<string | undefined> {
  const result = await runCommand(npmCommand(), ["view", packageName, "version", "--json"]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Failed to fetch latest version");
  }
  return normalizeVersion(result.stdout);
}

async function installLatest(packageName: string): Promise<void> {
  const result = await runCommand(npmCommand(), ["install", "-g", `${packageName}@latest`], true);
  if (result.code !== 0) {
    throw new Error("Self update failed");
  }
}

export async function performSelfUpdate(
  packageName: string,
  deps: UpdateDependencies = {}
): Promise<SelfUpdateResult> {
  const write = deps.write ?? ((message: string) => process.stdout.write(message));
  const resolveCurrent = deps.getCurrentVersion ?? getCurrentVersion;
  const resolveLatest = deps.getLatestVersion ?? getLatestVersion;
  const install = deps.installLatest ?? installLatest;

  const currentVersion = await resolveCurrent();

  let latestVersion: string | undefined;
  try {
    latestVersion = await resolveLatest(packageName);
  } catch {
    write("Could not check latest version. Proceeding with update.\n");
  }

  if (currentVersion && latestVersion && currentVersion === latestVersion) {
    write(`${packageName} is already up to date (${currentVersion}).\n`);
    return {
      updated: false,
      currentVersion,
      latestVersion
    };
  }

  if (currentVersion && latestVersion) {
    write(`Updating ${packageName} from ${currentVersion} to ${latestVersion}...\n`);
  } else if (latestVersion) {
    write(`Updating ${packageName} to ${latestVersion}...\n`);
  } else {
    write(`Updating ${packageName} to latest...\n`);
  }

  await install(packageName);
  write("Update completed.\n");

  return {
    updated: true,
    currentVersion,
    latestVersion
  };
}

