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

type PingDisplay = {
  ok: boolean;
  lines: string[];
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
): Promise<PingDisplay> {
  const activeBefore = await store.getActiveAccount();
  const shouldSwitch = activeBefore?.id !== target.id;

  if (shouldSwitch) {
    await oauthService.useAccount(target.id);
  }

  try {
    const result = await performPing();
    const missingFields: string[] = [];
    if (!result.projectId) {
      missingFields.push("project");
    }
    if (!result.finishReason) {
      missingFields.push("finish reason");
    }
    if (!result.traceId) {
      missingFields.push("trace id");
    }

    const ok = missingFields.length === 0;
    const lines = [
      `Ping account: ${formatAccountLabel(target)}`,
      `Status: ${ok ? "OK" : "FAIL"}`,
      `Model: ${result.model}`
    ];

    if (!ok) {
      lines.push(`Reason: Missing ${missingFields.join(", ")}`);
    }
    if (result.projectId) {
      lines.push(`Project: ${result.projectId}`);
    } else {
      lines.push("Project: (missing)");
    }
    if (result.finishReason) {
      lines.push(`Finish reason: ${result.finishReason}`);
    } else {
      lines.push("Finish reason: (missing)");
    }
    if (result.traceId) {
      lines.push(`Trace ID: ${result.traceId}`);
    } else {
      lines.push("Trace ID: (missing)");
    }

    lines.push("Response:");
    lines.push(result.responseText && result.responseText.trim().length > 0 ? result.responseText : "(empty)");
    return { ok, lines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      lines: [
        `Ping account: ${formatAccountLabel(target)}`,
        "Status: FAIL",
        `Error: ${message}`,
        "Response:",
        "(empty)"
      ]
    };
  } finally {
    if (shouldSwitch && activeBefore) {
      await oauthService.useAccount(activeBefore.id);
    }
  }
}

function renderResultScreen(display: PingDisplay): string {
  return [
    "+------------------------------------------------------------+",
    `| Ping Result: ${display.ok ? "OK" : "FAIL"}${" ".repeat(display.ok ? 35 : 33)}|`,
    "+------------------------------------------------------------+",
    ...display.lines,
    "",
    "Press Enter/Up/Down to return, Q/Esc to cancel",
    ""
  ].join("\n");
}

export async function runAuthPingFlow(options: RunAuthPingFlowOptions): Promise<string[]> {
  const { oauthService, store, io, performPing } = options;
  const accounts = await oauthService.listAccounts();
  if (accounts.length === 0) {
    return ["No accounts registered"];
  }

  const active = await store.getActiveAccount();
  if (!io.isTTY) {
    const display = await pingAccountAndDescribe(oauthService, store, performPing, active ?? accounts[0]);
    return display.lines;
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

    const display = await pingAccountAndDescribe(oauthService, store, performPing, selected.account);
    io.clear();
    io.write(`${renderResultScreen(display)}\n`);

    const nextKey = await io.readKey();
    if (nextKey === "cancel") {
      return ["Ping cancelled"];
    }
  }
}
