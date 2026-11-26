import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import {
  AGENT_PERMISSION_LEVELS,
  type AgentPermissionLevel,
  SETTING_LINK_IDS,
  type SettingLinkId,
} from "@openbot/contracts/ipc";

interface SettingLinkEntry {
  title: string;
  place: string;
  about: string;
  words: string;
}

const APP = "OpenBot Settings";
const AGENT = "agent settings (side panel of the agent's chat)";

const SETTING_LINKS: Record<SettingLinkId, SettingLinkEntry> = {
  "general.send-shortcut": {
    title: "Send shortcut",
    place: `${APP} > General`,
    about: "Which keys send a message: Enter, or Cmd/Ctrl+Enter.",
    words: "enter key newline keyboard composer submit",
  },
  "general.sort-chats": {
    title: "Sort chats",
    place: `${APP} > General`,
    about: "The order of the chats in the sidebar.",
    words: "sidebar order recent manual list",
  },
  "general.agent-steps": {
    title: "Show agent steps",
    place: `${APP} > General`,
    about: "Show or hide the steps and tool calls of an agent in the chat.",
    words: "tool calls thinking progress activity details verbose hide",
  },
  "general.compact-message-actions": {
    title: "Compact message actions",
    place: `${APP} > General`,
    about: "Show the copy, retry and other buttons of a message only on hover.",
    words: "buttons hover copy retry toolbar",
  },
  "general.external-links": {
    title: "Open external links in",
    place: `${APP} > General`,
    about: "Open links from chats in the OpenBot browser or the default browser of the computer.",
    words: "links browser chrome safari default open url",
  },
  "appearance.theme": {
    title: "Theme",
    place: `${APP} > Appearance`,
    about: "Light, dark or system colors.",
    words: "dark mode light mode night colors",
  },
  "appearance.language": {
    title: "Language",
    place: `${APP} > Appearance`,
    about: "The language of the OpenBot menus, buttons and messages.",
    words: "translation locale interface english polish german spanish french",
  },
  "appearance.interface-size": {
    title: "Interface size",
    place: `${APP} > Appearance`,
    about: "The size of text and controls.",
    words: "zoom scale bigger smaller font size text size",
  },
  "appearance.interface-font": {
    title: "Interface font",
    place: `${APP} > Appearance`,
    about: "The font of menus, chats and settings.",
    words: "typeface font family",
  },
  "appearance.code-font": {
    title: "Code font",
    place: `${APP} > Appearance`,
    about: "The font of code, terminals and file paths.",
    words: "monospace typeface terminal",
  },
  "appearance.chat-color": {
    title: "Chat color",
    place: `${APP} > Appearance`,
    about: "The color of the user's own message bubbles. People on the user's servers see it too.",
    words: "bubble color accent tint",
  },
  "appearance.bubble-style": {
    title: "Your bubbles",
    place: `${APP} > Appearance`,
    about: "In a chat with an agent, the user's bubbles take the agent's color.",
    words: "bubble color agent color style",
  },
  "appearance.chat-background": {
    title: "Chat background",
    place: `${APP} > Appearance`,
    about: "The background picture or pattern of chats.",
    words: "wallpaper pattern image",
  },
  "appearance.logo-color": {
    title: "Logo color",
    place: `${APP} > Appearance`,
    about: "The color of the OpenBot icon in the Dock, the taskbar and the Dynamic Island.",
    words: "app icon dock icon",
  },
  "notifications.desktop": {
    title: "Desktop notifications",
    place: `${APP} > Notifications`,
    about: "Show a system notification when an agent needs attention or finishes.",
    words: "alerts notify popup banner",
  },
  "notifications.preview": {
    title: "Show message preview",
    place: `${APP} > Notifications`,
    about: "Show the start of the agent's reply in notifications.",
    words: "privacy notification text content",
  },
  "notifications.task-sound": {
    title: "Play a sound when a task finishes",
    place: `${APP} > Notifications`,
    about: "A short sound when an agent finishes a task.",
    words: "sound chime ding done audio",
  },
  "notifications.action-sounds": {
    title: "Action sounds",
    place: `${APP} > Notifications`,
    about: "Short sounds that confirm actions, such as sending a message.",
    words: "sound effects click audio feedback",
  },
  "voice.dictation": {
    title: "Dictation",
    place: `${APP} > Voice`,
    about: "Speak a message instead of typing it.",
    words: "speech to text voice input microphone talk transcribe transcription whisper cloud elevenlabs groq api key",
  },
  "voice.dictation-language": {
    title: "Dictation language",
    place: `${APP} > Voice`,
    about: "The language that dictation listens for.",
    words: "speech language recognition",
  },
  "voice.read-replies": {
    title: "Read replies aloud",
    place: `${APP} > Voice`,
    about: "When the user dictates a message, OpenBot reads the agent's reply aloud.",
    words: "text to speech tts speak voice output read aloud audio say cloud elevenlabs xai api key",
  },
  "voice.speech-voice": {
    title: "Voice",
    place: `${APP} > Voice`,
    about: "The voice that reads replies aloud.",
    words: "tts voice speaker",
  },
  "voice.speech-speed": {
    title: "Speech speed",
    place: `${APP} > Voice`,
    about: "How fast replies are read aloud.",
    words: "tts rate faster slower",
  },
  "voice.codex-live": {
    title: "Codex live voice",
    place: `${APP} > Voice`,
    about:
      "Voice conversations with any agent use OpenAI live voice with a Codex sign-in (a ChatGPT account). The voice, the requests and the replies go to OpenAI.",
    words: "realtime live conversation talk openai chatgpt cloud speech to speech",
  },
  "voice.server": {
    title: "Voice server",
    place: `${APP} > Voice`,
    about:
      "Use your own OpenAI-compatible voice server for dictation, spoken replies or both, with its address and an optional API key.",
    words: "openai compatible self hosted local whisper endpoint url address api key cloud transcription tts stt",
  },
  "phones.devices": {
    title: "Your phones",
    place: `${APP} > Mobile Connect`,
    about: "Connect the OpenBot phone app (iPhone, Android) to this computer, and see the connected phones.",
    words: "mobile iphone android ios app pair qr code",
  },
  "app.launch-at-login": {
    title: "Launch OpenBot at login",
    place: `${APP} > App behavior`,
    about: "Open OpenBot when the user signs in to the computer.",
    words: "startup autostart boot login items",
  },
  "app.restore-workspace": {
    title: "Restore the last workspace on launch",
    place: `${APP} > App behavior`,
    about: "Open the workspace and tasks of the previous session at start.",
    words: "reopen session tabs",
  },
  "app.fast-server-connection": {
    title: "Fast connection to servers",
    place: `${APP} > App behavior`,
    about: "Keep the connections to joined servers open in the background.",
    words: "remote server connection background",
  },
  "app.keep-awake": {
    title: "Keep this computer awake",
    place: `${APP} > App behavior`,
    about: "Prevent sleep while agents work, so routines and long tasks continue.",
    words: "sleep caffeinate prevent sleep idle lid power",
  },
  "app.keep-awake-on-battery": {
    title: "Also on battery",
    place: `${APP} > App behavior`,
    about: "Keep the computer awake also when it is not plugged in.",
    words: "battery power sleep",
  },
  "island.show": {
    title: "Dynamic Island",
    place: `${APP} > Dynamic Island`,
    about: "Show agent activity and items that need attention at the top of the screen (the MacBook notch).",
    words: "notch status top of screen overlay",
  },
  "dock.show": {
    title: "Show the agent dock",
    place: `${APP} > Agent dock`,
    about: "Show the agents at the edge of the screen, for a quick chat from any app.",
    words: "dock floating edge quick chat overlay launcher",
  },
  "dock.agents": {
    title: "Agents on the dock",
    place: `${APP} > Agent dock`,
    about: "Choose which agents the dock shows.",
    words: "dock agents list",
  },
  "computer-use.permissions": {
    title: "System permissions",
    place: `${APP} > Computer Use`,
    about:
      "Shows if Computer Use is ready on this computer, and what is missing when it is not, with a button to fix it. Show it when Computer Use is not ready.",
    words: "computer use ready not ready permissions screen recording accessibility grant macos privacy driver",
  },
  "updates.track": {
    title: "Update track",
    place: `${APP} > Updates`,
    about: "Stable or beta releases of OpenBot.",
    words: "beta nightly channel version",
  },
  "updates.auto-install": {
    title: "Install updates automatically",
    place: `${APP} > Updates`,
    about: "Install new OpenBot versions without a question.",
    words: "auto update upgrade",
  },
  "credits.explainer": {
    title: "What are credits?",
    place: "OpenBot > Credits (the credits button in the narrow bar on the left, or Help > What are credits?)",
    about:
      "A short explainer of OpenBot credits: they pay for pictures, videos and voices that agents make, chats do not use them, each media model has its own price, and packs of credits can be bought.",
    words: "credits credit tokens token price prices cost costs pay balance buy pack packs media picture video free",
  },
  "agent.model": {
    title: "Agent model",
    place: AGENT,
    about: "The provider and model of this agent, and its reasoning effort.",
    words: "provider claude codex gpt gemini llm reasoning effort fast mode switch model",
  },
  "agent.backup-models": {
    title: "Backup models",
    place: AGENT,
    about: "Models that the agent uses when its own model hits a usage limit or fails.",
    words: "fallback limit failover",
  },
  "agent.chat-color": {
    title: "Chat color",
    place: AGENT,
    about: "The color of this agent's chat.",
    words: "agent color bubble",
  },
  "agent.instructions": {
    title: "Instructions",
    place: AGENT,
    about: "The standing instructions of this agent: persona, rules and reply style.",
    words: "system prompt rules persona agents.md claude.md behavior",
  },
  "agent.memories": {
    title: "Memories",
    place: AGENT,
    about: "The facts that this agent remembers, to read, edit or delete.",
    words: "memory remember forget saved facts",
  },
  "agent.skills": {
    title: "Skills",
    place: AGENT,
    about: "The skills that this agent can use.",
    words: "skill plugins abilities",
  },
  "agent.routines": {
    title: "Routines",
    place: AGENT,
    about: "The scheduled and webhook routines of this agent.",
    words: "schedule cron recurring every day reminder automation webhook",
  },
  "agent.notification-level": {
    title: "Notify me",
    place: AGENT,
    about: "Which messages of this agent send the user a notification.",
    words: "notifications mute quiet alerts",
  },
  "agent.access": {
    title: "Access",
    place: `${AGENT} > Permissions`,
    about:
      "What the agent can do without approval: Workspace only, Ask first or Full access. The choices depend on the provider: read_agent gives them in permissionLevels.",
    words: "permissions approvals sandbox full access ask workspace security",
  },
  "agent.computer-use": {
    title: "Computer Use",
    place: `${AGENT} > Permissions`,
    about:
      "Let this agent see the screen and control apps on this computer. It does not show if Computer Use is ready: computer-use.permissions does.",
    words: "control apps click screen mouse keyboard desktop automation",
  },
  "agent.local-scripts": {
    title: "Local scripts",
    place: `${AGENT} > Permissions`,
    about: "Let this agent run AppleScript and other local automation scripts.",
    words: "applescript automation scripts osascript",
  },
  "agent.folders": {
    title: "Folders",
    place: AGENT,
    about: "Extra folders that this agent can read and change.",
    words: "directories files access project folder workspace",
  },
  "agent.busy-message": {
    title: "While working",
    place: `${AGENT} > Advanced`,
    about:
      "What happens to a message from the user or another agent that arrives while the agent works: queue it or steer the work.",
    words: "queue steer interrupt busy",
  },
  "agent.browser-profile": {
    title: "Browser profile",
    place: `${AGENT} > Advanced`,
    about: "Which browser profile, with its sign-ins, this agent uses.",
    words: "browser cookies sign in logins profile chrome",
  },
  "agent.new-chat": {
    title: "New chat",
    place: `${AGENT} > Advanced`,
    about: "Start a new chat: the agent forgets this chat and keeps its setup.",
    words: "reset clear context forget conversation",
  },
  "agent.starts-new-chats": {
    title: "Agent starts new chats",
    place: `${AGENT} > Advanced`,
    about: "Let the agent start a new chat by itself when the context is full.",
    words: "context compaction reset",
  },
  "agent.plan-card": {
    title: "Show the plan before long tasks",
    place: `${AGENT} > Advanced`,
    about: "Before a long task, the agent shows its plan.",
    words: "plan card confirm before start",
  },
  "agent.builtin-memory": {
    title: "OpenBot memory",
    place: `${AGENT} > Advanced`,
    about:
      "Turn off OpenBot memory to use only a memory app that you connect, such as Mem0. The agent then does not read or save OpenBot memories. Saved memories stay.",
    words: "memory mem0 openviking provider external remember disable off",
  },
};

export interface SettingLinkSummary {
  id: SettingLinkId;
  title: string;
  place: string;
  about: string;
}

export function settingLinkSummary(id: SettingLinkId): SettingLinkSummary {
  const { title, place, about } = SETTING_LINKS[id];
  return { id, title, place, about };
}

const ACCESS_LEVEL_NAMES: Record<AgentPermissionLevel, string> = {
  workspace: "Workspace only",
  ask: "Ask first",
  full: "Full access",
};

export function agentAccessSummary(
  summary: SettingLinkSummary,
  levels: readonly AgentPermissionLevel[],
): SettingLinkSummary {
  if (summary.id !== "agent.access" || levels.length === AGENT_PERMISSION_LEVELS.length) return summary;
  const choices = levels.map((level) => ACCESS_LEVEL_NAMES[level]).join(", ");
  return {
    ...summary,
    about: `What the agent can do without approval. Your choices are: ${choices}. For another agent, read_agent gives its choices in permissionLevels.`,
  };
}

const terms = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1);

function hits(term: string, words: readonly string[]): boolean {
  return words.some(
    (word) => word === term || (term.length > 3 && word.startsWith(term)) || (word.length > 3 && term.startsWith(word)),
  );
}

function score(queryTerms: readonly string[], entry: SettingLinkEntry, sentences: boolean) {
  const title = terms(entry.title);
  const words = terms(entry.words);
  const rest = sentences ? terms(`${entry.about} ${entry.place}`) : [];
  let total = 0;
  for (const term of queryTerms) {
    if (hits(term, title)) total += 3;
    else if (hits(term, words)) total += 2;
    else if (term.length > 2 && hits(term, rest)) total += 1;
  }
  return total;
}

function rank<T>(
  items: readonly T[],
  entry: (item: T) => SettingLinkEntry,
  queryTerms: readonly string[],
  limit: number,
  sentences: boolean,
) {
  if (queryTerms.length === 0) return [];
  return items
    .map((item) => ({ item, score: score(queryTerms, entry(item), sentences) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((match) => match.item);
}

export function searchSettingLinks(query: string, limit = 5): SettingLinkSummary[] {
  return rank(SETTING_LINK_IDS, (id) => SETTING_LINKS[id], terms(query), limit, true).map(settingLinkSummary);
}

const SERVER_LIST = "On a computer: in the server list on the left, right-click the server";
const SERVER_SETTINGS = "Server settings (right-click the server in the server list on the left, then Server settings)";
const PHONE_SERVERS = "On the phone app: in Servers, touch and hold the server";

export type ServerPlace = Omit<SettingLinkEntry, "words">;

interface ServerPlaceEntry extends SettingLinkEntry {
  foundWithoutServerWord?: readonly string[];
  answersProviderAccountQuestion?: true;
}

const PROVIDER_WORDS: readonly string[] = [
  ...AGENT_PROVIDERS.filter((provider) => provider !== "acp"),
  "anthropic",
  "openai",
  "chatgpt",
  "gemini",
];
const ACCOUNT_WORDS = ["account", "subscription"];

const SERVER_PLACES: readonly ServerPlaceEntry[] = [
  {
    title: "Add a server",
    place:
      "On a computer: the server button at the bottom of the narrow bar on the left, below Settings (Open server menu for <server name>) > Add a server, or Add remote server when no plans show. In the Server rail layout, use the + button at the bottom of the server list instead; with plans, it opens Add a server directly. Add a server opens Run OpenBot 24/7 on an external server, with hosted server plans. In it, Other options > New server on another computer gives one install command for a Linux computer or VPS that the user owns (Ubuntu 24.04 or 26.04). When no plans show, New server on another computer is in that menu itself. New server on another computer is only in the desktop app, not in the browser at openbot.run/app. On the phone app: Servers > Add a server, for a hosted server.",
    about:
      "A server that runs 24/7 on another computer, so that agents, routines and chat apps such as WhatsApp keep working while this computer is off. The user runs the install command as root on that computer, then opens the new server and connects a provider and apps there. When the user gives the SSH address, create_server_install_command makes the same command for you to run over SSH.",
    words:
      "24 add new another install setup create always online run running keep alive offline off away cloud hosted hosting headless linux ubuntu external own",
  },
  {
    title: "Remove server",
    place: `${SERVER_LIST} > Remove server, or ${SERVER_SETTINGS} > General > Remove server. ${PHONE_SERVERS} > Remove server.`,
    about:
      "Only the owner. Removes the server from the account for all members and ends remote access, for example the server of an old computer that is not used now. It works also when that computer is off. Files and chats on that computer stay. It does not show for a hosted server or for the server on this computer.",
    words: "delete forget rid replace unregister old previous",
  },
  {
    title: "Leave server",
    place: `${SERVER_LIST} > Leave server, or ${SERVER_SETTINGS} > General > Leave server. ${PHONE_SERVERS} > Leave server.`,
    about: "A member who is not the owner removes a joined server from their own server list. The server stays.",
    words: "quit exit joined membership",
  },
  {
    title: "Transfer",
    place: `On a computer: ${SERVER_SETTINGS} > Transfer.`,
    about:
      "Owners and admins move the agents, with their skills, routines, memories and files, to another computer: export a .zip file from the old server, then import it into the new server.",
    words: "move migrate migration copy new",
  },
  {
    title: "Import",
    place: `On a computer: ${SERVER_SETTINGS} > Import. On the phone app: the server's Server settings > Import agents.`,
    about:
      "Any member copies agents from another app into this server: Grok Bot (an export agent there makes a .zip file) or Hermes Agent (its folder or an exported .zip file). Owners and admins also see Another OpenBot computer, which opens Transfer. The user sees every item before anything changes.",
    words: "importing grok hermes bot bring",
    foundWithoutServerWord: ["import", "hermes"],
  },
  {
    title: "Vault",
    place: `On a computer: ${SERVER_SETTINGS} > Vault. The API keys filter shows the saved keys; the menu of a key has Copy API key and Copy variable name.`,
    about:
      "Only the owner or an admin. The saved logins, cards, contact info and API keys that agents use, also the keys that an agent saved with save_api_key. A Marketplace app does not read the Vault: to use a saved key in an app, copy it here, then open Marketplace, open the app, and paste it where the app asks for its key (Change key when the app is connected). A member asks the owner.",
    words: "vault api key keys token tokens secret secrets password passwords credential credentials",
    foundWithoutServerWord: ["vault", "api", "key", "keys", "token", "secret", "credential", "password"],
  },
  {
    title: "Use my Claude Code setup",
    place: `On a computer: ${SERVER_SETTINGS} > Providers > Claude > Use my Claude Code setup.`,
    about:
      "Only the owner or an admin. On: Claude agents load the CLAUDE.md, skills, agents, hooks and plugins from ~/.claude on that server. Off, the default: each turn sends a shorter prompt. Workspace files load either way. A member asks the owner.",
    words: "claude code claude.md home user own personal setup config hooks plugins skills load",
    foundWithoutServerWord: ["claude"],
  },
  {
    title: "Provider accounts",
    place: `On a computer: ${SERVER_SETTINGS} > Providers > the provider, such as Claude or ChatGPT > Accounts > Add account. On the phone app: Server settings > Providers > the provider > Add account; for some providers, the phone says to add the account on a computer.`,
    about:
      "Only the owner or an admin of the server. Signs in one more account of a provider, for example a second Claude or ChatGPT subscription, or adds an API key. Each agent uses one account: choose it in the agent's settings. Pool accounts lets the agents of a provider share its accounts.",
    words: ["account accounts subscription pool", ...PROVIDER_WORDS].join(" "),
    answersProviderAccountQuestion: true,
  },
  {
    title: "Parallel threads",
    place: `For one agent, on the phone app: the agent's settings > Advanced > Behavior > Parallel threads. For all agents, on a computer: ${SERVER_SETTINGS} > Agent defaults > Parallel threads per agent and Threads at the same time. On the phone app: the server's Server settings > Agents.`,
    about:
      "Only the owner or an admin changes these rows; a member asks the owner. How many threads of an agent run at the same time; the others wait. An agent's Parallel threads on Default uses the server's Parallel threads per agent, which is 4 until it is changed. Parallel threads per agent applies to each agent with no limit of its own, and Threads at the same time limits all agent threads of the server; more threads use more memory. A provider that runs one turn at a time runs one thread at a time.",
    words: "parallel concurrent concurrency simultaneous simultaneously threads task tasks",
    foundWithoutServerWord: ["parallel", "concurrent", "concurrency", "simultaneous", "simultaneously"],
  },
];

const CHAT_PLACES: readonly SettingLinkEntry[] = [
  {
    title: "Threads",
    place:
      "In the agent's chat, the chat header: + (New thread) starts a thread, and the thread menu shows the thread tabs, New thread and All threads. On a message: Branch in new thread. On the phone app: touch the agent's name at the top of the chat for Main chat, New thread and All threads.",
    about:
      "More conversations with the same agent beside its main chat, for example for parallel work. Each thread has its own conversation and context: it does not see the messages of the main chat or of other threads, except the messages that a branch copies. All threads share the agent's memories, skills, settings and working directory.",
    words: "parallel side tab tabs branch fork session sessions conversation",
  },
  {
    title: "Voice conversation",
    place:
      "On a computer: in the agent's chat, with an empty message box, the voice button in place of Send (Start voice conversation). The voice bar has Mute the microphone, Interrupt, End voice conversation, and How you talk: Open microphone or Push to talk. On the phone app: in a chat with an agent or a channel, with an empty message box, the voice button in place of Send (Start a voice conversation). When the phone has no voice yet, it opens Settings > Voice. The button shows only where voice is available.",
    about:
      "A continuous spoken conversation with the agent: OpenBot listens, the agent replies aloud, then OpenBot listens again, with no dictation for each message. It uses the voices of Settings > Voice. Codex live voice, an OpenAI voice with a ChatGPT sign-in, is optional, not required.",
    words: "talk talking speak spoken live realtime continuous handsfree hands call microphone listen",
  },
];

export function searchChatPlaces(query: string, limit = 1): ServerPlace[] {
  return rank(CHAT_PLACES, (entry) => entry, terms(query), limit, false).map(({ title, place, about }) => ({
    title,
    place,
    about,
  }));
}

const SERVER_TERMS = ["server", "computer", "machine", "device", "laptop", "macbook", "imac", "mac", "pc", "vps"];

export function searchServerPlaces(query: string, limit = 2): ServerPlace[] {
  const queryTerms = terms(query);
  const asksAboutProviderAccount =
    queryTerms.some((term) => hits(term, ACCOUNT_WORDS)) && queryTerms.some((term) => PROVIDER_WORDS.includes(term));
  const places = queryTerms.some((term) => hits(term, SERVER_TERMS))
    ? SERVER_PLACES
    : SERVER_PLACES.filter(
        ({ foundWithoutServerWord, answersProviderAccountQuestion }) =>
          (foundWithoutServerWord && queryTerms.some((term) => hits(term, foundWithoutServerWord))) ||
          (answersProviderAccountQuestion && asksAboutProviderAccount),
      );
  if (places.length === 0) return [];
  const scored = queryTerms.filter((term) => !hits(term, SERVER_TERMS));
  return rank(places, (entry) => entry, scored, limit, false).map(({ title, place, about }) => ({
    title,
    place,
    about,
  }));
}
