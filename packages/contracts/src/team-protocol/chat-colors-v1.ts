import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
} from "./admin-wire";

export const CHAT_COLORS_CAPABILITY = "chat-colors-v1";
export const CHAT_COLORS_ROUTES = {
  read: "/v1/chat-colors",
  set: "/v1/chat-colors/set",
} as const;

const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const isColor = (input: unknown): input is `#${string}` => typeof input === "string" && COLOR_PATTERN.test(input);
const color: AdminDecoder = (input) => {
  if (!isColor(input)) throw new Error("Invalid chat color.");
  return input;
};
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid chat color request.");
    return decode(input);
  };
const agents = list(fields({ agentId: identifier, color }), 1000);
const members = list(fields({ memberId: identifier, color }), 100);
const snapshot = fields({ agents, members });

export const CHAT_COLORS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CHAT_COLORS_ROUTES.read, adminRoute(empty, snapshot)],
  [
    CHAT_COLORS_ROUTES.set,
    adminRoute(exact(["agentId", "color"], fields({ agentId: identifier, color: nullable(color) })), snapshot),
  ],
]);

export interface ChatColorsSnapshot {
  agents: { agentId: string; color: `#${string}` }[];
  members: { memberId: string; color: `#${string}` }[];
}

export type ChatColorsEvent = { type: "chat-colors-changed" } & ChatColorsSnapshot;

export function decodeChatColorsSnapshot(input: unknown): ChatColorsSnapshot {
  const decoded = snapshot(input);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.agents) || !Array.isArray(decoded.members))
    throw new Error("Invalid chat colors.");
  return {
    agents: decoded.agents.map((entry) => {
      if (!isDynamicRecord(entry) || typeof entry.agentId !== "string" || !isColor(entry.color))
        throw new Error("Invalid chat colors.");
      return { agentId: entry.agentId, color: entry.color };
    }),
    members: decoded.members.map((entry) => {
      if (!isDynamicRecord(entry) || typeof entry.memberId !== "string" || !isColor(entry.color))
        throw new Error("Invalid chat colors.");
      return { memberId: entry.memberId, color: entry.color };
    }),
  };
}

export function chatColorsEvent(input: unknown): ChatColorsEvent | null {
  if (!isDynamicRecord(input) || input.type !== "chat-colors-changed") return null;
  return {
    type: "chat-colors-changed",
    ...decodeChatColorsSnapshot({ agents: input.agents, members: input.members }),
  };
}
