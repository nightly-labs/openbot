import {
  type AgentStatus,
  type AttachmentSummary,
  CHANNEL_CHATS_CAPABILITY,
  type ChannelMessage,
  type ChannelSummary,
  type ClientAgentModelOption,
  type ClientAgentSummary,
  type ConversationMessage,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { AGENT_WELCOME_CAPABILITY, TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { SIDEBAR_PINS_CAPABILITY, SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import type { HostFile } from "../attachment-media";
import { createWorkspace, type Workspace } from "../workspace";

const NOW = "2026-11-20T10:30:00.000Z";
const EARLIER = "2026-11-19T16:05:00.000Z";

export function agent(
  fields: Partial<ClientAgentSummary> & Pick<ClientAgentSummary, "id" | "name">,
): ClientAgentSummary {
  return {
    provider: "claude",
    title: "",
    description: "",
    notifications: true,
    model: "claude-haiku-5-5",
    reasoningEffort: "medium",
    access: "full",
    threadId: `thread-${fields.id}`,
    workspacePath: `/srv/openbot/Agents/${fields.id}`,
    preview: "",
    updatedAt: EARLIER,
    avatarSeed: fields.id,
    avatarHue: 245,
    avatarUrl: null,
    ...fields,
  };
}

export const STORY_AGENTS: ClientAgentSummary[] = [
  agent({
    id: "chief",
    name: "Chief",
    title: "Chief of staff",
    description: "Coordinates priorities, decisions, and handoffs across the team.",
    preview: "The launch plan is ready. Research checked the sources.",
    updatedAt: NOW,
    avatarHue: 245,
  }),
  agent({
    id: "x-desk",
    name: "X Desk",
    title: "Posts from X",
    description: "Checks the posts that you send from X.",
    preview: "The claim is not supported by the study it names.",
    avatarSeed: "x-desk",
    avatarHue: 280,
  }),
  agent({
    id: "launch",
    name: "Launch",
    title: "Launch manager",
    description: "Keeps the launch checklist moving.",
    preview: "Publication is still blocked. Two items must close first.",
    avatarHue: 320,
  }),
  agent({
    id: "research",
    name: "Research",
    title: "Research partner",
    description: "Finds and checks sources.",
    preview: "Which claim is still open, and what would close it?",
    avatarHue: 150,
  }),
  agent({
    id: "builder",
    name: "Builder",
    title: "Engineer",
    description: "Builds and ships changes.",
    preview: "Add the rollback step to the checklist and keep the flag off.",
    avatarHue: 30,
  }),
];

const STORY_MODELS: ClientAgentModelOption[] = [
  {
    provider: "claude",
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    description: "Fast and efficient for everyday agent work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    provider: "claude",
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    description: "Most capable for complex, long-running work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["medium", "high"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Fast and efficient for everyday agent work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
];

const STORY_STATUS: AgentStatus = {
  phase: "ready",
  cliVersion: "2.1.231",
  auth: { kind: "chatgpt", email: "person@example.com" },
  providers: [
    { id: "claude", state: "available", version: "2.1.231", message: null, email: "person@example.com" },
    { id: "codex", state: "available", version: "0.144.1", message: null, email: "person@example.com" },
  ],
  capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
  message: null,
  fullAccess: true,
};

export const STORY_FILES: AttachmentSummary[] = [
  file("image", "q3-revenue.png", "image/png", 48_000, "image", "image"),
  file("pdf", "Q3 report.pdf", "application/pdf", 1_240_000, "file", "pdf"),
  file("md", "summary.md", "text/markdown", 3_100, "file", "text"),
  file(
    "xlsx",
    "pipeline.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    88_000,
    "file",
    "none",
  ),
  file("audio", "standup-notes.wav", "audio/wav", 32_044, "file", "none"),
  file("zip", "assets.zip", "application/zip", 5_400_000, "file", "none"),
];

function file(
  id: string,
  name: string,
  mimeType: string,
  size: number,
  kind: AttachmentSummary["kind"],
  previewKind: AttachmentSummary["previewKind"],
): AttachmentSummary {
  return { id: `file-${id}`, name, mimeType, size, kind, previewKind, previewUrl: null };
}

export function message(
  id: string,
  author: "user" | "assistant",
  text: string,
  fields: Partial<ConversationMessage> = {},
): ConversationMessage {
  return { id, author, source: author, text, createdAt: EARLIER, status: "completed", ...fields };
}

export const STORY_CHIEF_MESSAGES: ConversationMessage[] = [
  message("m1", "user", "Can you turn the launch notes into a short plan, and ask @Research to check the sources?"),
  message(
    "m2",
    "assistant",
    "Here is the plan:\n\n1. **Freeze** the release branch on Monday.\n2. Ask Research to confirm the numbers in the press note.\n3. Ship on Thursday, with the rollback step ready.\n\n| Step | Owner | Day |\n| --- | --- | --- |\n| Freeze | Builder | Mon |\n| Sources | Research | Tue |\n| Ship | Launch | Thu |",
  ),
  message("m3", "user", "Great. Send me the files too."),
  message("m4", "assistant", "Done. The **Q3 report** is attached, with the chart, a summary and the pipeline sheet.", {
    attachments: STORY_FILES,
  }),
];

const STORY_LAYOUT: SidebarLayoutSnapshot = {
  revision: 1,
  sections: [
    { id: "folder-work", name: "Work" },
    { id: "folder-launch", name: "Launch week", parentId: "folder-work" },
  ],
  order: ["folder-work", "folder-launch", "people", "unassigned"],
  agentAssignments: { launch: "folder-launch", builder: "folder-work", "channel-launch": "folder-launch" },
  agentOrder: [],
};

export const STORY_CHANNEL: ChannelSummary = {
  id: "channel-launch",
  name: "Launch room",
  title: "",
  instructions: "",
  members: [{ agentId: "chief" }, { agentId: "builder" }, { agentId: "launch" }, { agentId: "research" }],
  leadAgentId: "chief",
  archived: false,
  revision: 3,
  createdAt: EARLIER,
  unreadCount: 2,
  activeTasks: 0,
  lastMessage: {
    authorName: "Chief",
    author: { kind: "agent", id: "chief" },
    text: "Assigned to Builder.",
    at: EARLIER,
  },
};

export const MEMBER_ID = "member-you";

export function channelMessage(sequence: number, author: ChannelMessage["author"], text: string): ChannelMessage {
  return {
    id: `channel-message-${sequence}`,
    channelId: STORY_CHANNEL.id,
    sequence,
    author,
    taskId: null,
    superseded: false,
    message: message(`cm-${sequence}`, author.kind === "member" ? "user" : "assistant", text),
  };
}

const STORY_CHANNEL_MESSAGES: ChannelMessage[] = [
  channelMessage(
    1,
    { kind: "member", id: MEMBER_ID, name: "You" },
    "We ship on Thursday. Who takes the rollback step?",
  ),
  channelMessage(2, { kind: "agent", id: "chief", name: "Chief" }, "Builder takes it. I assigned the task."),
  channelMessage(
    3,
    { kind: "agent", id: "builder", name: "Builder" },
    "On it. The flag stays off until the checks pass.",
  ),
  channelMessage(4, { kind: "agent", id: "builder", name: "Builder" }, "The rollback script is in the checklist now."),
  channelMessage(
    5,
    { kind: "agent", id: "research", name: "Research" },
    "The numbers in the press note are confirmed.",
  ),
];

export interface StoryServerOptions {
  agents?: ClientAgentSummary[];
  chats?: Record<string, ConversationMessage[]>;
  answering?: string;
  unread?: Record<string, number>;
  folders?: boolean;
  channels?: ChannelSummary[];
  channelMessages?: ChannelMessage[];
  channelWorkers?: string[];
  failChat?: boolean;
  dictation?: boolean;
  pins?: { kind: "agent" | "channel"; id: string }[];
}

function storyPicture(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 600;
  const paint = canvas.getContext("2d");
  if (paint) {
    const fill = paint.createLinearGradient(0, 0, 960, 600);
    fill.addColorStop(0, "#5b6cf0");
    fill.addColorStop(1, "#ec4899");
    paint.fillStyle = fill;
    paint.fillRect(0, 0, 960, 600);
    paint.fillStyle = "#ffffff";
    paint.font = "bold 72px sans-serif";
    paint.fillText("Q3 revenue", 60, 320);
  }
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

export async function storyWorkspace(options: StoryServerOptions = {}): Promise<Workspace> {
  const agents = options.agents ?? STORY_AGENTS;
  const channels = options.channels ?? [];
  const capabilities = [
    AGENT_WELCOME_CAPABILITY,
    TEAM_AGENT_CREATE_MODEL_CAPABILITY,
    ...(options.folders ? ["sidebar-layout"] : []),
    ...(options.channels ? [CHANNEL_CHATS_CAPABILITY] : []),
    ...(options.dictation ? ["voice-transcription-v1"] : []),
    ...(options.pins ? [SIDEBAR_PINS_CAPABILITY] : []),
  ];
  const request: TeamApiRequest = async (method, path, decode) => {
    if (path === TEAM_API_ROUTES.agents.all) return decode(agents);
    if (path === TEAM_API_ROUTES.agents.models) return decode(STORY_MODELS);
    if (path === TEAM_API_ROUTES.agents.status) return decode(STORY_STATUS);
    if (path === TEAM_API_ROUTES.agents.conversationReads)
      return decode(
        Object.fromEntries(
          Object.entries(options.unread ?? {}).map(([id, count]) => [
            id,
            { unreadCount: count, firstUnreadMessageId: null, throughMessageId: null },
          ]),
        ),
      );
    if (path === TEAM_API_ROUTES.sidebarLayout.state) return decode(STORY_LAYOUT);
    if (path === TEAM_API_ROUTES.me) return decode({ id: MEMBER_ID });
    if (path === SIDEBAR_PINS_ROUTES.read) return decode({ items: options.pins ?? [], updatedAt: null });
    if (path === CHANNEL_ROUTES.list) return decode(channels);
    if (path === CHANNEL_ROUTES.read) {
      const channel = channels[0] ?? STORY_CHANNEL;
      const messages = options.channelMessages ?? STORY_CHANNEL_MESSAGES;
      return decode({
        channel,
        messages,
        tasks: (options.channelWorkers ?? []).map((agentId, index) => ({
          id: `task-${agentId}`,
          channelId: channel.id,
          rootTaskId: `task-${agentId}`,
          parentTaskId: null,
          ownerAgentId: agentId,
          requestMessageId: messages[0]?.id ?? `request-${index}`,
          attachmentDraftIds: [],
          instruction: "Check the launch checklist.",
          expectedResult: "",
          sourceMessageIds: [],
          dependencies: [],
          resources: [],
          state: "running",
          revision: 1,
          assignmentCount: 1,
          error: null,
        })),
        olderCursor: null,
        throughSequence: messages.at(-1)?.sequence ?? 0,
      });
    }
    const chat = /^\/v1\/agents\/([^/]+)\/conversation$/.exec(path);
    if (chat?.[1]) {
      if (options.failChat) throw new Error("The server did not answer. Try again.");
      const agentId = decodeURIComponent(chat[1]);
      return decode({
        agentId,
        threadId: `thread-${agentId}`,
        activeTurnId: options.answering === agentId ? "turn-story" : null,
        revision: 1,
        messages: options.chats?.[agentId] ?? [],
      });
    }
    if (path === CHANNEL_ROUTES.command) return decode(channels[0] ?? STORY_CHANNEL);
    if (method === "POST") return decode({});
    throw new Error(`The story server has no ${method} ${path}.`);
  };
  const picture = storyPicture();
  const download = async (attachmentId: string): Promise<HostFile> =>
    attachmentId === "file-image"
      ? { name: "q3-revenue.png", mimeType: "image/png", base64: picture }
      : { name: "file.txt", mimeType: "text/plain", base64: "" };
  const workspace = createWorkspace(
    request,
    capabilities,
    download,
    async () => "Please summarize the open page for me.",
  );
  await workspace.load();
  return workspace;
}

type StoredValue = chrome.storage.StoredValue;
type ChangeListener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => void;

export function installStoryChrome(stored: { [key: string]: StoredValue } = {}): void {
  const items = new Map<string, StoredValue>(Object.entries(stored));
  const listeners = new Set<ChangeListener>();
  const keysOf = (keys: string | string[] | null) =>
    keys === null ? [...items.keys()] : Array.isArray(keys) ? keys : [keys];
  const stub = {
    storage: {
      local: {
        get: async (keys: string | string[] | null) =>
          Object.fromEntries(keysOf(keys).flatMap((key) => (items.has(key) ? [[key, items.get(key)]] : []))),
        set: async (values: { [key: string]: StoredValue }) => {
          for (const [key, value] of Object.entries(values)) items.set(key, value);
          for (const listener of listeners)
            listener(
              Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }])),
              "local",
            );
        },
        remove: async (keys: string | string[]) => {
          for (const key of keysOf(keys)) items.delete(key);
        },
      },
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.add(listener),
        removeListener: (listener: ChangeListener) => listeners.delete(listener),
      },
    },
    runtime: {
      id: "storybook",
      getURL: (path: string) => `/${path}`,
      sendMessage: async () => undefined,
      connect: () => ({ name: "story", disconnect: () => undefined, onDisconnect: { addListener: () => undefined } }),
      onMessage: { addListener: () => undefined, removeListener: () => undefined },
    },
    identity: {
      launchWebAuthFlow: async () => {
        throw new Error("No sign-in window in Storybook.");
      },
    },
    tabs: {
      create: async () => ({}),
      getCurrent: async () => undefined,
      remove: async () => undefined,
    },
  };
  if (typeof chrome !== "object") {
    Object.defineProperty(globalThis, "chrome", { value: stub, configurable: true, writable: true });
    return;
  }
  for (const [key, value] of Object.entries(stub))
    Object.defineProperty(chrome, key, { value, configurable: true, writable: true });
}
