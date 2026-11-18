import { type ChatBackdropScene, isChatBackdropScene } from "@openbot/brand/chat-backdrop-scenes";
import { type ChatBackdropBubbles, chatBackdropBubbles } from "@openbot/contracts/chat-visual";
import { isAvatarColor } from "@openbot/contracts/ipc";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * The backdrop behind Home and the chats on this phone: none, a built-in scene, the page that an agent
 * set with `set_backdrop`, or a photo that the user chose. The choice stays on this phone, as on
 * the desktop, where it is per computer and browser.
 */
export type ChatBackdropChoice = "none" | ChatBackdropScene | "agent" | "photo";

/** The page that an agent set. The page file is in the backdrop folder; this is what the app knows of it. */
export interface AgentBackdropPage {
  serverId: string;
  agentId: string;
  /** The message that carried the page. Its chat shows Undo for it. */
  messageId: string;
  /** The page title: the text of the message. */
  name: string;
  bubbles: ChatBackdropBubbles | null;
}

export interface ChatBackdropValue {
  choice: ChatBackdropChoice;
  /** How much of the scene shows, from calm (0.1) to vivid (1). A calm scene keeps long replies easy to read. */
  strength: number;
  agentPage: AgentBackdropPage | null;
  /** The file name of the chosen photo in the backdrop folder. */
  photo: string | null;
  /**
   * A message older than the mark does not change the backdrop: the history of a chat, a message
   * that this phone took before, or one from before this phone first ran this code.
   */
  mark: number;
}

/** What Undo puts back after an agent set a page: the choice and the page before it. */
interface AgentBackdropUndo {
  agentId: string;
  messageId: string;
  choice: ChatBackdropChoice;
  page: { meta: AgentBackdropPage; html: string } | null;
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
  // A new page in the same file: the views read it again.
  pageVersion: 0,
}));

/** The folder that keeps the agent page and the photo. It is in the app files, not in the cache. */
function backdropFolder(): Directory {
  const folder = new Directory(Paths.document, "chat-backdrop");
  folder.create({ intermediates: true, idempotent: true });
  return folder;
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
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const fields = new Map<string, unknown>(Object.entries(value));
  const choice = fields.get("choice");
  const strength = fields.get("strength");
  const mark = fields.get("mark");
  const agentPage = parseAgentPage(fields.get("agentPage"));
  const photo = textField(fields, "photo");
  let parsedChoice: ChatBackdropChoice = isChoice(choice) ? choice : "none";
  // A choice whose file is gone shows nothing.
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

export async function loadChatBackdrop(): Promise<void> {
  if (useChatBackdrop.getState().ready) return;
  try {
    const value = parseStored(await SecureStore.getItemAsync(key));
    // A second startup read must not overwrite a change made in Settings.
    if (!useChatBackdrop.getState().ready) useChatBackdrop.setState(value ?? { mark: Date.now() });
    // The first run sets the mark, so the history of each chat stays in the chat.
    if (!value) await persist();
  } finally {
    useChatBackdrop.setState({ ready: true });
  }
}

/** Saves a change of Settings. It applies at once, also when storage fails. */
export async function saveChatBackdrop(change: Partial<Pick<ChatBackdropValue, "choice" | "strength">>) {
  if (!useChatBackdrop.getState().ready) return;
  useChatBackdrop.setState({ ...change, undo: null });
  await persist();
}

/** Shows a strength while the finger moves on the slider. `saveChatBackdrop` keeps it when the finger lifts. */
export function previewChatBackdropStrength(strength: number): void {
  useChatBackdrop.setState({ strength });
}

/**
 * Keeps a photo that the user chose as the backdrop. The photo is copied into the backdrop folder,
 * so the library can change without changing the backdrop.
 */
export async function saveBackdropPhoto(source: File, extension: string): Promise<void> {
  const state = useChatBackdrop.getState();
  if (!state.ready) return;
  const name = `photo-${Date.now()}.${extension.replace(/[^a-z0-9]/giu, "") || "jpg"}`;
  await source.copy(backdropPhotoFile(name));
  const old = state.photo;
  useChatBackdrop.setState({ photo: name, choice: "photo", undo: null });
  if (old) deleteQuietly(backdropPhotoFile(old));
  await persist();
}

/**
 * Puts a page that an agent set behind Home and the chats, and keeps what Undo puts back. `time` is
 * the time of the message; a page older than the mark, or than the last page, changes nothing.
 */
export async function setAgentBackdrop(page: AgentBackdropPage, html: string, time: number): Promise<boolean> {
  const state = useChatBackdrop.getState();
  if (!state.ready || time <= state.mark) return false;
  const file = agentBackdropFile();
  let previousHtml: string | null = null;
  if (state.agentPage && file.exists) {
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
    undo: {
      agentId: page.agentId,
      messageId: page.messageId,
      choice: state.choice,
      page: state.agentPage && previousHtml !== null ? { meta: state.agentPage, html: previousHtml } : null,
    },
  });
  await persist();
  return true;
}

/** Undo of an agent's page: the backdrop and the page before it come back. */
export async function undoAgentBackdrop(): Promise<void> {
  const { undo, pageVersion } = useChatBackdrop.getState();
  if (!undo) return;
  if (undo.page) {
    await agentBackdropFile().write(undo.page.html);
    useChatBackdrop.setState({ agentPage: undo.page.meta, pageVersion: pageVersion + 1 });
  } else if (undo.choice !== "agent") {
    deleteQuietly(agentBackdropFile());
    useChatBackdrop.setState({ agentPage: null });
  }
  useChatBackdrop.setState({ choice: undo.choice, undo: null });
  await persist();
}

/** Hides Undo, such as when the user closes it or leaves the chat. */
export function dismissAgentBackdropUndo(): void {
  useChatBackdrop.setState({ undo: null });
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // A file that stays is never read: the saved state no longer names it.
  }
}

/** Removes the agent page, so the phone keeps no copy of a server's file after it lost access to it. */
function dropAgentPage(): void {
  const { agentPage, choice } = useChatBackdrop.getState();
  if (!agentPage) return;
  deleteQuietly(agentBackdropFile());
  useChatBackdrop.setState({ agentPage: null, undo: null, ...(choice === "agent" ? { choice: "none" } : {}) });
  void persist().catch(() => undefined);
}

/** Server removal: the page of a removed server goes. */
export function forgetAgentBackdrops(serverIds: ReadonlySet<string>): void {
  const page = useChatBackdrop.getState().agentPage;
  if (page && serverIds.has(page.serverId)) dropAgentPage();
}

/** The confirmed list of servers: the page of a server that is not in it goes. */
export function retainAgentBackdrops(serverIds: readonly string[]): void {
  const page = useChatBackdrop.getState().agentPage;
  if (page && !serverIds.includes(page.serverId)) dropAgentPage();
}

/** Sign-out and the end of a session: the agent page goes, as the phone's copy of the servers does. */
export function deleteAgentBackdrops(): void {
  dropAgentPage();
}
