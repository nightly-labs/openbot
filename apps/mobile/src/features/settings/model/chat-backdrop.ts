import { type ChatBackdropScene, isChatBackdropScene } from "@openbot/brand/chat-backdrop-scenes";
import { type ChatBackdropBubbles, chatBackdropBubbles } from "@openbot/contracts/chat-visual";
import { isAvatarColor } from "@openbot/contracts/ipc";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { storedFields } from "./stored-fields";

export type ChatBackdropChoice = "none" | ChatBackdropScene | "agent" | "photo";

export interface AgentBackdropPage {
  serverId: string;
  agentId: string;
  messageId: string;
  name: string;
  bubbles: ChatBackdropBubbles | null;
}

export interface ChatBackdropValue {
  choice: ChatBackdropChoice;
  strength: number;
  agentPage: AgentBackdropPage | null;
  photo: string | null;
  mark: number;
}

interface AgentBackdropUndo {
  serverId: string;
  agentId: string;
  messageId: string;
  choice: ChatBackdropChoice;
  page: { meta: AgentBackdropPage; html: string } | null;
  removed?: true;
}

export const CHAT_BACKDROP_STRENGTH = { min: 0.1, max: 1, default: 0.55 } as const;

const key = "openbot.mobile.chat-backdrop.v1";
const AGENT_PAGE_FILE = "agent-page.html";

export const useChatBackdrop = create<
  ChatBackdropValue & { ready: boolean; undo: AgentBackdropUndo | null; pageVersion: number }
>(() => ({
  choice: "none",
  strength: CHAT_BACKDROP_STRENGTH.default,
  agentPage: null,
  photo: null,
  mark: 0,
  ready: false,
  undo: null,
  pageVersion: 0,
}));

function backdropFolder(): Directory {
  return new Directory(Paths.document, "chat-backdrop");
}

function createBackdropFolder(): void {
  backdropFolder().create({ intermediates: true, idempotent: true });
}

export function agentBackdropFile(): File {
  return new File(backdropFolder(), AGENT_PAGE_FILE);
}

export function backdropPhotoFile(name: string): File {
  return new File(backdropFolder(), name);
}

function isChoice(value: unknown): value is ChatBackdropChoice {
  return value === "none" || value === "agent" || value === "photo" || isChatBackdropScene(value);
}

function textField(fields: Map<string, unknown>, name: string): string | null {
  const value = fields.get(name);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseAgentPage(value: unknown): AgentBackdropPage | null {
  if (typeof value !== "object" || value === null) return null;
  const fields = new Map<string, unknown>(Object.entries(value));
  const serverId = textField(fields, "serverId");
  const agentId = textField(fields, "agentId");
  const messageId = textField(fields, "messageId");
  const name = typeof fields.get("name") === "string" ? String(fields.get("name")) : "";
  if (!serverId || !agentId || !messageId) return null;
  const bubbles = fields.get("bubbles");
  const bubbleFields = new Map<string, unknown>(
    typeof bubbles === "object" && bubbles !== null ? Object.entries(bubbles) : [],
  );
  const yours = bubbleFields.get("yours");
  const agents = bubbleFields.get("agents");
  const colors: ChatBackdropBubbles = {
    ...(isAvatarColor(yours) ? { yours } : {}),
    ...(isAvatarColor(agents) ? { agents } : {}),
  };
  return {
    serverId,
    agentId,
    messageId,
    name,
    bubbles: colors.yours || colors.agents ? colors : null,
  };
}

function parseStored(stored: string | null): ChatBackdropValue | null {
  const fields = storedFields(stored);
  if (!fields) return null;
  const choice = fields.get("choice");
  const strength = fields.get("strength");
  const mark = fields.get("mark");
  const agentPage = parseAgentPage(fields.get("agentPage"));
  const photo = textField(fields, "photo");
  let parsedChoice: ChatBackdropChoice = isChoice(choice) ? choice : "none";
  if ((parsedChoice === "agent" && !agentPage) || (parsedChoice === "photo" && !photo)) parsedChoice = "none";
  return {
    choice: parsedChoice,
    strength:
      typeof strength === "number" && Number.isFinite(strength)
        ? Math.min(CHAT_BACKDROP_STRENGTH.max, Math.max(CHAT_BACKDROP_STRENGTH.min, strength))
        : CHAT_BACKDROP_STRENGTH.default,
    agentPage,
    photo,
    mark: typeof mark === "number" && Number.isFinite(mark) && mark > 0 ? mark : Date.now(),
  };
}

async function persist(): Promise<void> {
  const { choice, strength, agentPage, photo, mark } = useChatBackdrop.getState();
  await SecureStore.setItemAsync(key, JSON.stringify({ choice, strength, agentPage, photo, mark }));
}

const pendingCleanup: { all: boolean; servers: Set<string>; kept: readonly string[] | null } = {
  all: false,
  servers: new Set(),
  kept: null,
};

function pageServerGone(serverId: string): boolean {
  return (
    pendingCleanup.all ||
    pendingCleanup.servers.has(serverId) ||
    (pendingCleanup.kept !== null && !pendingCleanup.kept.includes(serverId))
  );
}

function loadedState(value: ChatBackdropValue): ChatBackdropValue {
  let { choice, agentPage, photo } = value;
  if (agentPage && (pageServerGone(agentPage.serverId) || !agentBackdropFile().exists)) {
    deleteQuietly(agentBackdropFile());
    agentPage = null;
  }
  if (photo && !backdropPhotoFile(photo).exists) photo = null;
  if ((choice === "agent" && !agentPage) || (choice === "photo" && !photo)) choice = "none";
  return { ...value, choice, agentPage, photo };
}

export async function loadChatBackdrop(): Promise<void> {
  if (useChatBackdrop.getState().ready) return;
  try {
    const stored = parseStored(await SecureStore.getItemAsync(key));
    const value = stored ? loadedState(stored) : null;
    if (!useChatBackdrop.getState().ready) useChatBackdrop.setState(value ?? { mark: Date.now() });
    if (!value || value.choice !== stored?.choice || value.agentPage !== stored.agentPage) await persist();
  } finally {
    useChatBackdrop.setState({ ready: true });
  }
}

export async function saveChatBackdrop(change: Partial<Pick<ChatBackdropValue, "choice" | "strength">>) {
  if (!useChatBackdrop.getState().ready) return;
  useChatBackdrop.setState({ ...change, undo: null });
  await persist();
}

export function previewChatBackdropStrength(strength: number): void {
  useChatBackdrop.setState({ strength });
}

export async function saveBackdropPhoto(source: File, extension: string): Promise<void> {
  const state = useChatBackdrop.getState();
  if (!state.ready) return;
  const name = `photo-${Date.now()}.${extension.replace(/[^a-z0-9]/giu, "") || "jpg"}`;
  createBackdropFolder();
  await source.copy(backdropPhotoFile(name));
  const old = state.photo;
  useChatBackdrop.setState({ photo: name, choice: "photo", undo: null });
  await persist();
  if (old) deleteQuietly(backdropPhotoFile(old));
}

export async function setAgentBackdrop(
  page: AgentBackdropPage,
  html: string,
  time: number,
  {
    offerUndo,
  }: {
    offerUndo: boolean;
  },
): Promise<boolean> {
  const state = useChatBackdrop.getState();
  if (!state.ready || time <= state.mark) return false;
  createBackdropFolder();
  const file = agentBackdropFile();
  let previousHtml: string | null = null;
  if (offerUndo && state.agentPage && file.exists) {
    try {
      previousHtml = await file.text();
    } catch {
      previousHtml = null;
    }
  }
  await file.write(html);
  useChatBackdrop.setState({
    choice: "agent",
    agentPage: { ...page, bubbles: chatBackdropBubbles(html) },
    mark: time,
    pageVersion: state.pageVersion + 1,
    undo: offerUndo
      ? {
          serverId: page.serverId,
          agentId: page.agentId,
          messageId: page.messageId,
          choice: state.choice,
          page: state.agentPage && previousHtml !== null ? { meta: state.agentPage, html: previousHtml } : null,
        }
      : null,
  });
  await persist();
  return true;
}

export async function clearAgentBackdrop(
  source: Pick<AgentBackdropUndo, "serverId" | "agentId" | "messageId">,
  time: number,
  { offerUndo }: { offerUndo: boolean },
): Promise<boolean> {
  const state = useChatBackdrop.getState();
  if (!state.ready || time <= state.mark) return false;
  const shown = state.choice !== "none";
  useChatBackdrop.setState({
    mark: time,
    ...(shown
      ? {
          choice: "none" as const,
          undo: offerUndo ? { ...source, choice: state.choice, page: null, removed: true as const } : null,
        }
      : {}),
  });
  await persist();
  return shown;
}

export async function undoAgentBackdrop(): Promise<void> {
  const { undo, pageVersion } = useChatBackdrop.getState();
  if (!undo) return;
  if (undo.page) {
    createBackdropFolder();
    await agentBackdropFile().write(undo.page.html);
    useChatBackdrop.setState({ agentPage: undo.page.meta, pageVersion: pageVersion + 1 });
  } else if (undo.choice !== "agent" && !undo.removed) {
    deleteQuietly(agentBackdropFile());
    useChatBackdrop.setState({ agentPage: null });
  }
  useChatBackdrop.setState({ choice: undo.choice, undo: null });
  await persist();
}

export function dismissAgentBackdropUndo(): void {
  useChatBackdrop.setState({ undo: null });
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {}
}

function dropAgentPages(gone: (serverId: string) => boolean): void {
  const { agentPage, choice, undo } = useChatBackdrop.getState();
  const pageGone = agentPage !== null && gone(agentPage.serverId);
  const undoGone = undo !== null && (gone(undo.serverId) || (undo.page !== null && gone(undo.page.meta.serverId)));
  if (!pageGone && !undoGone) return;
  if (pageGone) deleteQuietly(agentBackdropFile());
  useChatBackdrop.setState({
    undo: null,
    ...(pageGone ? { agentPage: null, ...(choice === "agent" ? { choice: "none" as const } : {}) } : {}),
  });
  if (pageGone) void persist().catch(() => undefined);
}

export function forgetAgentBackdrops(serverIds: ReadonlySet<string>): void {
  if (!useChatBackdrop.getState().ready) for (const id of serverIds) pendingCleanup.servers.add(id);
  dropAgentPages((serverId) => serverIds.has(serverId));
}

export function retainAgentBackdrops(serverIds: readonly string[]): void {
  if (!useChatBackdrop.getState().ready) pendingCleanup.kept = serverIds;
  dropAgentPages((serverId) => !serverIds.includes(serverId));
}

export function deleteAgentBackdrops(): void {
  if (!useChatBackdrop.getState().ready) pendingCleanup.all = true;
  dropAgentPages(() => true);
}
