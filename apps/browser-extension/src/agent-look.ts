import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import type { AvatarColor, ClientAgentSummary } from "@openbot/contracts/ipc";
import type { AppFormat } from "@openbot/i18n";
import { toAgentProfile } from "@openbot/ui/features/agents/agent-profile";
import type { AgentPicture } from "./agent-pictures";

export interface AgentLook {
  colors: Record<string, AvatarColor>;
  pictures: Record<string, AgentPicture>;
}

function shownPicture(agent: ClientAgentSummary, look: AgentLook): string | null {
  const picture = look.pictures[agent.id];
  return picture && picture.source === agent.avatarUrl ? picture.url : null;
}

export function avatarAgent(agent: ClientAgentSummary, look: AgentLook) {
  return {
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
    avatarColor: look.colors[agent.id] ?? null,
    avatarUrl: shownPicture(agent, look),
  };
}

export function lookProfile(agent: ClientAgentSummary, look: AgentLook) {
  const avatarUrl = shownPicture(agent, look) ?? agent.avatarUrl;
  return toAgentProfile({ ...agent, avatarColor: look.colors[agent.id] ?? null, avatarUrl });
}

export function bubbleColors(agent: ClientAgentSummary, color: AvatarColor | undefined) {
  const fill = avatarHeadColor(agent.avatarSeed, agent.avatarHue, color ?? null);
  return { "--ext-agent": fill, "--ext-on-agent": readableOn(fill) };
}

function readableOn(hex: string) {
  const parts = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!parts) return "#ffffff";
  const [r = 0, g = 0, b = 0] = parts.slice(1).map((part) => {
    const channel = Number.parseInt(part, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.0569 ? "#ffffff" : "#141414";
}

export function rowTime(value: string | null, format: AppFormat): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? format.date(date, { hour: "numeric", minute: "2-digit" })
    : format.date(date, { month: "short", day: "numeric" });
}

export function byRecent(left: ClientAgentSummary, right: ClientAgentSummary): number {
  return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
}

export function composerAgents(agents: readonly ClientAgentSummary[], look: AgentLook) {
  return agents.map((entry) => ({
    id: entry.id,
    name: entry.name,
    title: entry.title,
    description: entry.description,
    ...avatarAgent(entry, look),
  }));
}
