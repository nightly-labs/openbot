import type { NotificationMetadata } from "@openbot/telemetry";
import { TOAST_DURATION, toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { For } from "solid-js";

type McpStartFailureGroup = { id: string; lines: string[] };

const groups = new Map<string, McpStartFailureGroup>();
let groupCount = 0;

function openGroup(serverId: string): McpStartFailureGroup {
  const group = groups.get(serverId);
  if (group && toast.getToasts().some((item) => item.id === group.id)) return group;
  const next = { id: `mcp-not-started:${serverId}:${++groupCount}`, lines: [] };
  groups.set(serverId, next);
  return next;
}

function durationThatRestartsTimer(lineCount: number): number {
  return TOAST_DURATION + lineCount - 1;
}

export function showMcpStartFailureToast(
  serverId: string,
  line: string,
  options: { action?: { label: string; onClick: () => void }; report: NotificationMetadata },
): void {
  const group = openGroup(serverId);
  if (group.lines.includes(line)) return;
  group.lines.push(line);
  const lines = [...group.lines];
  const { t } = currentText();
  toast.error(lines.length === 1 ? t("agent.error.mcpNotStarted") : t("agent.error.mcpNotStartedSeveral"), {
    id: group.id,
    description: lines.length === 1 ? line : () => <For each={lines}>{(text) => <div>{text}</div>}</For>,
    duration: durationThatRestartsTimer(lines.length),
    action: options.action,
    report: options.report,
  });
}
