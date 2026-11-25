import type { MobileTranslate } from "@openbot/i18n/mobile";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import type { CarPlayAgentItem, CarPlayHome } from "../carplay-native";

const PINNED_LIMIT = 8;

export interface CarPlayHomeInput {
  agents: readonly MobileAgent[];
  pinnedAgentIds: readonly string[];
  unreadAgentIds: readonly string[];
  pictures: ReadonlyMap<string, string>;
  locked: boolean;
  t: MobileTranslate;
}

export function carPlayAgentKey(agent: Pick<MobileAgent, "serverId" | "id">): string {
  return JSON.stringify([agent.serverId, agent.id]);
}

function newestFirst(left: MobileAgent, right: MobileAgent): number {
  return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
}

function emptyHome(t: MobileTranslate, message?: string): CarPlayHome {
  return {
    title: t("mobile.carplay.title"),
    ...(message ? { message } : {}),
    pinnedTitle: t("mobile.carplay.pinned"),
    newTitle: t("mobile.carplay.new"),
    agentsTitle: t("mobile.carplay.agents"),
    pinned: [],
    fresh: [],
    quiet: [],
  };
}

export function signedOutCarPlayHome(t: MobileTranslate): CarPlayHome {
  return emptyHome(t, t("mobile.carplay.signedOut"));
}

export function buildCarPlayHome({
  agents,
  pinnedAgentIds,
  unreadAgentIds,
  pictures,
  locked,
  t,
}: CarPlayHomeInput): CarPlayHome {
  if (locked) return emptyHome(t, t("mobile.carplay.locked"));
  if (agents.length === 0) return emptyHome(t, t("mobile.carplay.noAgents"));
  const unread = new Set(unreadAgentIds);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const pinned = pinnedAgentIds.flatMap((id) => byId.get(id) ?? []).slice(0, PINNED_LIMIT);
  const pinnedIds = new Set(pinned.map((agent) => agent.id));
  const item = (agent: MobileAgent): CarPlayAgentItem => {
    const isUnread = unread.has(agent.id);
    const detail = (isUnread ? agent.preview : agent.title).trim();
    const picture = pictures.get(carPlayAgentKey(agent));
    return {
      key: carPlayAgentKey(agent),
      name: agent.name,
      unread: isUnread,
      ...(detail ? { detail } : {}),
      ...(picture ? { picture } : {}),
    };
  };
  return {
    ...emptyHome(t),
    pinned: pinned.map(item),
    fresh: agents
      .filter((agent) => unread.has(agent.id))
      .sort(newestFirst)
      .map(item),
    quiet: agents.filter((agent) => !pinnedIds.has(agent.id) && !unread.has(agent.id)).map(item),
  };
}
