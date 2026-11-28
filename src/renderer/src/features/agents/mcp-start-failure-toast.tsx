import type { NotificationMetadata } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { For } from "solid-js";

type McpStartFailureGroup = { id: string; lines: string[] };

const openGroups = new Map<string, McpStartFailureGroup>();
let groupCount = 0;

export function showMcpStartFailureToast(
  serverId: string,
  line: string,
  options: { action?: { label: string; onClick: () => void }; report: NotificationMetadata },
): void {
  const group = openGroups.get(serverId) ?? { id: `mcp-not-started:${serverId}:${++groupCount}`, lines: [] };
  if (group.lines.includes(line)) return;
  group.lines.push(line);
  openGroups.set(serverId, group);
  const lines = [...group.lines];
  const close = () => {
    if (openGroups.get(serverId) === group) openGroups.delete(serverId);
  };
  const { t } = currentText();
  toast.error(lines.length === 1 ? t("agent.error.mcpNotStarted") : t("agent.error.mcpNotStartedSeveral"), {
    id: group.id,
    description: lines.length === 1 ? line : () => <For each={lines}>{(text) => <div>{text}</div>}</For>,
    ...(options.action ? { action: options.action } : {}),
    report: options.report,
    onDismiss: close,
    onAutoClose: close,
  });
}
