import type { AgentMessage, ChatActionMarkerModel } from "@openbot/ui/data";
import { startsDay } from "./agent-message-timeline";

type SkillMarker = Extract<ChatActionMarkerModel, { kind: "skill-lifecycle" }>;

interface InstallRow {
  message: AgentMessage;
  marker: SkillMarker;
}

/**
 * Joins consecutive installs of one skill revision into one row, so an agent that installs a skill
 * for many agents does not fill the chat with equal rows. The row keeps the id of the first install,
 * so it stays the same row while installs join. The stored messages stay unchanged.
 *
 * A group stops at the first unread message and at a new day, so the unread divider and the day
 * separator keep a row of their own.
 */
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
