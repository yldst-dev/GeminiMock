import type { AccountStore, StoredAccount } from "../auth/account-store.js";
import type { OAuthService } from "../auth/oauth-service.js";

export type PingKey = "up" | "down" | "enter" | "cancel";

export type PingTuiIO = {
  isTTY: boolean;
  write(message: string): void;
  clear(): void;
  readKey(): Promise<PingKey>;
};

type PingService = Pick<OAuthService, "listAccounts" | "useAccount">;
type PingStore = Pick<AccountStore, "getActiveAccount">;

type MenuItem =
  | { kind: "account"; account: StoredAccount }
  | { kind: "cancel" };

export type PingResult = {
  model: string;
  responseText?: string;
  projectId?: string;
  finishReason?: string;
  traceId?: string;
};

export type RunAuthPingFlowOptions = {
  oauthService: PingService;
  store: PingStore;
  io: PingTuiIO;
  performPing: () => Promise<PingResult>;
};

function formatAccountLabel(account: StoredAccount): string {
  return account.email ? `${account.id} (${account.email})` : account.id;
}

function moveIndex(current: number, delta: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  const next = (current + delta) % total;
  return next < 0 ? next + total : next;
}

function buildMenuItems(accounts: StoredAccount[]): MenuItem[] {
  return [
    ...accounts.map((account) => ({ kind: "account", account } as const)),
    { kind: "cancel" as const }
  ];
}

function initialMainIndex(accounts: StoredAccount[], activeId: string | undefined): number {
  if (!activeId) {
    return 0;
  }
  const index = accounts.findIndex((account) => account.id === activeId);
  return index < 0 ? 0 : index;
}

function renderMainScreen(items: MenuItem[], index: number, activeId: string | undefined): string {
  const lines = [
    "+------------------------------------------------------------+",
    "| GeminiMock Account Ping Selector                          |",
    "+------------------------------------------------------------+",
    "Use Up/Down to move, Enter to ping, Q/Esc to cancel",
    "Legend: [*] active account",
    ""
  ];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const marker = i === index ? ">" : " ";
    if (item.kind === "account") {
      const activeMarker = item.account.id === activeId ? "*" : " ";
      const email = item.account.email ?? "(no email)";
      lines.push(`${marker} [${activeMarker}] ${email}  ${item.account.id}`);
      continue;
    }
    lines.push(`${marker} [ ] Cancel`);
  }

  lines.push("");
  return lines.join("\n");
}

async function pingAccountAndDescribe(
  oauthService: PingService,
  store: PingStore,
  performPing: () => Promise<PingResult>,
  target: StoredAccount
): Promise<string[]> {
  const activeBefore = await store.getActiveAccount();
  const shouldSwitch = activeBefore?.id !== target.id;

  if (shouldSwitch) {
    await oauthService.useAccount(target.id);
  }

  try {
    const result = await performPing();
    const lines = [
      `Ping account: ${formatAccountLabel(target)}`,
      `Model: ${result.model}`
    ];

    if (result.projectId) {
      lines.push(`Project: ${result.projectId}`);
    }
    if (result.finishReason) {
      lines.push(`Finish reason: ${result.finishReason}`);
    }
    if (result.traceId) {
      lines.push(`Trace ID: ${result.traceId}`);
    }

    lines.push("Response:");
    lines.push(result.responseText && result.responseText.trim().length > 0 ? result.responseText : "(empty)");
    return lines;
  } finally {
    if (shouldSwitch && activeBefore) {
      await oauthService.useAccount(activeBefore.id);
    }
  }
}

export async function runAuthPingFlow(options: RunAuthPingFlowOptions): Promise<string[]> {
  const { oauthService, store, io, performPing } = options;
  const accounts = await oauthService.listAccounts();
  if (accounts.length === 0) {
    return ["No accounts registered"];
  }

  const active = await store.getActiveAccount();
  if (!io.isTTY) {
    return pingAccountAndDescribe(oauthService, store, performPing, active ?? accounts[0]);
  }

  const items = buildMenuItems(accounts);
  let index = initialMainIndex(accounts, active?.id);

  while (true) {
    io.clear();
    io.write(`${renderMainScreen(items, index, active?.id)}\n`);

    const key = await io.readKey();
    if (key === "up") {
      index = moveIndex(index, -1, items.length);
      continue;
    }
    if (key === "down") {
      index = moveIndex(index, 1, items.length);
      continue;
    }
    if (key === "cancel") {
      return ["Ping cancelled"];
    }

    const selected = items[index];
    if (!selected || selected.kind === "cancel") {
      return ["Ping cancelled"];
    }
    return pingAccountAndDescribe(oauthService, store, performPing, selected.account);
  }
}
