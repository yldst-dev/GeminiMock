---
name: terminal-tui-reliability
description: Reliability patterns for terminal TUI flows in Node/Bun CLIs. Use when building or debugging raw-mode keyboard handling, cooked/raw transitions, accidental key carryover, selection screens, and login/account TUI UX.
---

# Terminal TUI Reliability

Use this skill for CLI TUI flows that read arrow/enter/cancel keys and switch between raw and cooked terminal modes.

## Workflow

1. Identify the screen state machine and transition edges.
2. Audit key mapping for destructive exits. Prefer minimal cancel keys.
3. On cooked->raw transitions, clear pending queues and ignore transient key events briefly.
4. Add guard rails after sensitive transitions:
- ignore first cancel immediately after a successful action screen
- require explicit user selection to exit
5. Keep visual instructions aligned with actual key mapping.
6. Add regression tests for accidental immediate-exit scenarios.

## Guard Rail Rules

- Use `Ctrl+C` as the primary cancel for login flows.
- Avoid mapping single printable keys as cancel where pasted input may leak.
- After completing login, ignore one immediate `cancel` event before honoring cancel.
- Ensure finish requires explicit selection + enter.

## Test Scenarios

- start screen cancel before login
- single login then finish
- repeated login flow
- accidental cancel right after login completion should not exit immediately

## References

For implementation checklist, read `references/tui-checklist.md`.
