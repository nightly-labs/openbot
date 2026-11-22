import type { AgentMessage, ChatActionMarkerModel } from "@openbot/ui/data";
import { startsDay } from "./agent-message-timeline";

type SkillMarker = Extract<ChatActionMarkerModel, { kind: "skill-lifecycle" }>;

interface InstallRow {
  message: AgentMessage;
  marker: SkillMarker;
}

export function groupSkillInstallMarkers(
  messages: readonly AgentMessage[],
  firstUnreadMessageId?: string | null,
): AgentMessage[] {
  const rows: AgentMessage[] = [];
  let group: InstallRow[] = [];
  const closeGroup = () => {
    const first = group[0];
    const last = group.at(-1);
    if (first && last) {
      rows.push(
        group.length === 1
          ? first.message
          : {
              ...first.message,
              actionMarker: {
                ...first.marker,
                timestamp: last.marker.timestamp,
                installMessageIds: group.map((row) => row.message.id),
              },
            },
      );
    }
    group = [];
  };

  for (const message of messages) {
    const marker = installMarker(message);
    if (!marker) {
      closeGroup();
      rows.push(message);
      continue;
    }
    const previous = group.at(-1);
    if (
      previous &&
      (previous.marker.skillId !== marker.skillId ||
        previous.marker.revision !== marker.revision ||
        message.id === firstUnreadMessageId ||
        startsDay(previous.message, message))
    ) {
      closeGroup();
    }
    group.push({ message, marker });
  }
  closeGroup();
  return rows;
}

function installMarker(message: AgentMessage): SkillMarker | null {
  const marker = message.actionMarker;
  return marker?.kind === "skill-lifecycle" && marker.action === "installed" ? marker : null;
}
