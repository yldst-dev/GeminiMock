import type { AccountStore, StoredAccount } from "../auth/account-store.js";
import type { OAuthService } from "../auth/oauth-service.js";

export type LogoutKey = "up" | "down" | "enter" | "cancel";

export type LogoutTuiIO = {
  isTTY: boolean;
  write(message: string): void;
  clear(): void;
  readKey(): Promise<LogoutKey>;
};

type LogoutService = Pick<OAuthService, "listAccounts" | "logout" | "logoutAll" | "removeAccount">;
type LogoutStore = Pick<AccountStore, "getActiveAccount">;

type MenuItem =
  | { kind: "account"; account: StoredAccount }
  | { kind: "all" }
  | { kind: "cancel" };

type ScreenState =
  | { kind: "main"; index: number }
  | { kind: "confirmAll"; index: number };

export type RunAuthLogoutFlowOptions = {
  oauthService: LogoutService;
  store: LogoutStore;
  io: LogoutTuiIO;
  forceAll?: boolean;
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
    { kind: "all" as const },
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
    "| GeminiMock Logout Selector                                |",
    "+------------------------------------------------------------+",
    "Use Up/Down to move, Enter to select, Q/Esc to cancel",
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
    if (item.kind === "all") {
      lines.push(`${marker} [ ] Logout ALL accounts`);
      continue;
    }
    lines.push(`${marker} [ ] Cancel`);
  }

  lines.push("");
  return lines.join("\n");
}

function renderConfirmAllScreen(index: number): string {
  const options = ["No, keep accounts", "Yes, logout ALL accounts"];
  const lines = [
    "+------------------------------------------------------------+",
    "| Confirm Logout ALL Accounts                               |",
    "+------------------------------------------------------------+",
    "Use Up/Down and Enter to confirm",
    ""
  ];
  for (let i = 0; i < options.length; i += 1) {
    const marker = i === index ? ">" : " ";
    lines.push(`${marker} ${options[i]}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function logoutActiveAndDescribe(
  oauthService: LogoutService,
  store: LogoutStore
): Promise<string[]> {
  const activeBefore = await store.getActiveAccount();
  const removed = await oauthService.logout();
  if (!removed) {
    return ["No active account to logout"];
  }
  const activeAfter = await store.getActiveAccount();
  const lines = [`Logged out account: ${formatAccountLabel(removed)}`];
  if (!activeBefore || activeBefore.id !== removed.id) {
    if (activeAfter) {
      lines.push(`Active account unchanged: ${formatAccountLabel(activeAfter)}`);
    } else {
      lines.push("No active account remaining");
    }
    return lines;
  }
  if (!activeAfter) {
    lines.push("No accounts remaining");
    return lines;
  }
  lines.push(`Active account switched to: ${formatAccountLabel(activeAfter)}`);
  return lines;
}

async function logoutSpecificAndDescribe(
  oauthService: LogoutService,
  store: LogoutStore,
  target: StoredAccount
): Promise<string[]> {
  const activeBefore = await store.getActiveAccount();
  if (activeBefore?.id === target.id) {
    return logoutActiveAndDescribe(oauthService, store);
  }
  const removed = await oauthService.removeAccount(target.id);
  if (!removed) {
    return [`Account not found: ${target.id}`];
  }
  const activeAfter = await store.getActiveAccount();
  const lines = [`Logged out account: ${formatAccountLabel(target)}`];
  if (!activeAfter) {
    lines.push("No active account remaining");
    return lines;
  }
  lines.push(`Active account unchanged: ${formatAccountLabel(activeAfter)}`);
  return lines;
}

export async function runAuthLogoutFlow(options: RunAuthLogoutFlowOptions): Promise<string[]> {
  const { oauthService, store, io, forceAll = false } = options;
  const accounts = await oauthService.listAccounts();
  if (accounts.length === 0) {
    return ["No accounts registered"];
  }

  if (forceAll) {
    await oauthService.logoutAll();
    return ["All OAuth accounts cleared"];
  }

  if (!io.isTTY) {
    return logoutActiveAndDescribe(oauthService, store);
  }

  const active = await store.getActiveAccount();
  const items = buildMenuItems(accounts);
  let state: ScreenState = {
    kind: "main",
    index: initialMainIndex(accounts, active?.id)
  };

  while (true) {
    io.clear();
    if (state.kind === "main") {
      io.write(`${renderMainScreen(items, state.index, active?.id)}\n`);
    } else {
      io.write(`${renderConfirmAllScreen(state.index)}\n`);
    }

    const key = await io.readKey();

    if (state.kind === "main") {
      if (key === "up") {
        state = { kind: "main", index: moveIndex(state.index, -1, items.length) };
        continue;
      }
      if (key === "down") {
        state = { kind: "main", index: moveIndex(state.index, 1, items.length) };
        continue;
      }
      if (key === "cancel") {
        return ["Logout cancelled"];
      }

      const selected = items[state.index];
      if (!selected || selected.kind === "cancel") {
        return ["Logout cancelled"];
      }
      if (selected.kind === "all") {
        state = { kind: "confirmAll", index: 0 };
        continue;
      }
      return logoutSpecificAndDescribe(oauthService, store, selected.account);
    }

    if (key === "up") {
      state = { kind: "confirmAll", index: moveIndex(state.index, -1, 2) };
      continue;
    }
    if (key === "down") {
      state = { kind: "confirmAll", index: moveIndex(state.index, 1, 2) };
      continue;
    }
    if (key === "cancel") {
      return ["Logout cancelled"];
    }
    if (state.index === 1) {
      await oauthService.logoutAll();
      return ["All OAuth accounts cleared"];
    }
    return ["Logout cancelled"];
  }
}
