export type LoginKey = "up" | "down" | "enter" | "cancel";

export type LoginTuiIO = {
  isTTY: boolean;
  write(message: string): void;
  clear(): void;
  readKey(): Promise<LoginKey>;
};

type LoginResult = { email?: string };

type ScreenState =
  | { kind: "start"; index: number }
  | { kind: "after"; index: number; lastLoginAccount: string };

export type RunAuthLoginFlowOptions = {
  io: LoginTuiIO;
  doLogin: () => Promise<LoginResult>;
};

function moveIndex(current: number, delta: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  const next = (current + delta) % total;
  return next < 0 ? next + total : next;
}

function renderStartScreen(index: number): string {
  const options = ["Start OAuth login", "Cancel"];
  const lines = [
    "+------------------------------------------------------------+",
    "| GeminiMock Login Selector                                 |",
    "+------------------------------------------------------------+",
    "Use Up/Down to move, Enter to select, Ctrl+C to cancel",
    ""
  ];
  for (let i = 0; i < options.length; i += 1) {
    const marker = i === index ? ">" : " ";
    lines.push(`${marker} ${options[i]}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderAfterLoginScreen(index: number, lastLoginAccount: string): string {
  const options = ["Login another account", "Finish"];
  const lines = [
    "+------------------------------------------------------------+",
    "| Login Completed                                            |",
    "+------------------------------------------------------------+",
    `Last login account: ${lastLoginAccount}`,
    "Use Up/Down and Enter",
    ""
  ];
  for (let i = 0; i < options.length; i += 1) {
    const marker = i === index ? ">" : " ";
    lines.push(`${marker} ${options[i]}`);
  }
  lines.push("");
  return lines.join("\n");
}

function successLine(result: LoginResult): string {
  return `OAuth login succeeded${result.email ? `: ${result.email}` : ""}`;
}

function loginAccountLabel(result: LoginResult): string {
  return result.email ?? "(email unavailable)";
}

export async function runAuthLoginFlow(options: RunAuthLoginFlowOptions): Promise<string[]> {
  const { io, doLogin } = options;
  if (!io.isTTY) {
    const result = await doLogin();
    return [successLine(result)];
  }

  const lines: string[] = [];
  let state: ScreenState = { kind: "start", index: 0 };
  let ignoreNextCancelOnAfter = false;

  while (true) {
    io.clear();
    if (state.kind === "start") {
      io.write(`${renderStartScreen(state.index)}\n`);
    } else {
      io.write(`${renderAfterLoginScreen(state.index, state.lastLoginAccount)}\n`);
    }

    const key = await io.readKey();
    if (state.kind === "start") {
      if (key === "up") {
        state = { kind: "start", index: moveIndex(state.index, -1, 2) };
        continue;
      }
      if (key === "down") {
        state = { kind: "start", index: moveIndex(state.index, 1, 2) };
        continue;
      }
      if (key === "cancel") {
        return ["Login cancelled"];
      }
      if (state.index === 1) {
        return ["Login cancelled"];
      }
      const result = await doLogin();
      lines.push(successLine(result));
      ignoreNextCancelOnAfter = true;
      state = { kind: "after", index: 0, lastLoginAccount: loginAccountLabel(result) };
      continue;
    }

    if (key === "up") {
      ignoreNextCancelOnAfter = false;
      state = {
        kind: "after",
        index: moveIndex(state.index, -1, 2),
        lastLoginAccount: state.lastLoginAccount
      };
      continue;
    }
    if (key === "down") {
      ignoreNextCancelOnAfter = false;
      state = {
        kind: "after",
        index: moveIndex(state.index, 1, 2),
        lastLoginAccount: state.lastLoginAccount
      };
      continue;
    }
    if (key === "cancel") {
      if (ignoreNextCancelOnAfter) {
        ignoreNextCancelOnAfter = false;
        continue;
      }
      lines.push("Login flow finished");
      return lines;
    }
    if (state.index === 0) {
      ignoreNextCancelOnAfter = false;
      const result = await doLogin();
      lines.push(successLine(result));
      ignoreNextCancelOnAfter = true;
      state = { kind: "after", index: 0, lastLoginAccount: loginAccountLabel(result) };
      continue;
    }
    lines.push("Login flow finished");
    return lines;
  }
}
