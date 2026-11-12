import type { DraftAttachment } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Bot, File, Folder, Plug, type Puzzle, ShieldCheck, Store, UsersRound } from "@openbot/ui";
import type { ComposerAgent, ComposerBrowserTab, ComposerMcpServer, ComposerSkill, ComposerThread } from "../../data";
import type { TextValue } from "../../text";
import { browserDisplayUrl } from "../browser/browser-suggestions";

/**
 * Where the picker hangs, and from which element. Like the queue panel, it is a child of
 * `.composer-wrap` that hangs from the composer's top edge, so the composer paints over its
 * bottom and it grows out from under the input. `mount` is undefined for an editor rendered
 * without a composer around it, which leaves the panel where Solid puts an unmounted portal.
 */
export interface PickerFrame {
  mount: HTMLElement | undefined;
  bottom: number;
}

export type PickerOption =
  | { type: "agent"; agent: ComposerAgent }
  /** Addresses every member of a channel. It inserts the text `@everyone`. */
  | { type: "everyone" }
  /** `showSlug` is set when another listed skill has the same name: the slug tells them apart. */
  | { type: "skill"; skill: ComposerSkill; showSlug: boolean }
  | { type: "mcp"; server: ComposerMcpServer }
  | { type: "attachment"; attachment: DraftAttachment }
  /** A browser tab of the agent. The agent gets its tab id and can use it with its browser tool. */
  | { type: "tab"; tab: ComposerBrowserTab }
  /** A side thread of the agent. The agent gets its task id and can read its history. */
  | { type: "thread"; thread: ComposerThread };

/**
 * A group of the `@` list. When the list has more than one group, each group shows its title and
 * its count over its rows.
 */
export interface PickerSection {
  id: string;
  title: AppTextKey | null;
  options: PickerOption[];
}

export function pickerOptionKey(option: PickerOption): string {
  if (option.type === "agent") return `agent:${option.agent.id}`;
  if (option.type === "everyone") return "everyone";
  if (option.type === "skill") return `skill:${option.skill.skillId}`;
  if (option.type === "tab") return `tab:${option.tab.id}`;
  if (option.type === "thread") return `thread:${option.thread.id}`;
  return option.type === "mcp" ? `mcp:${option.server.id}` : `attachment:${option.attachment.id}`;
}

export function pickerOptionText(option: PickerOption, t: TextValue["t"]): string {
  if (option.type === "agent") return t("composer.picker.option.agent", { name: option.agent.name });
  if (option.type === "everyone") return t("composer.picker.everyone");
  if (option.type === "skill") {
    const name = option.showSlug ? `${option.skill.name} ${option.skill.slug}` : option.skill.name;
    return t("composer.picker.option.skill", { name });
  }
  if (option.type === "tab") return t("composer.picker.option.tab", { name: tabTitle(option.tab) });
  if (option.type === "thread") return t("composer.picker.option.thread", { name: option.thread.title });
  return option.type === "mcp"
    ? t("composer.picker.option.mcp", { name: option.server.name })
    : t("composer.picker.option.file", { name: option.attachment.name });
}

export function pickerOptionName(option: PickerOption, t: TextValue["t"]): string {
  if (option.type === "agent") return option.agent.name;
  if (option.type === "everyone") return t("composer.picker.everyone");
  if (option.type === "skill") return option.skill.name;
  if (option.type === "tab") return tabTitle(option.tab);
  if (option.type === "thread") return option.thread.title;
  return option.type === "mcp" ? option.server.name : option.attachment.name;
}

export function pickerOptionDescription(
  option: PickerOption,
  t: TextValue["t"],
  format: TextValue["format"],
): string | undefined {
  if (option.type === "everyone") return t("composer.picker.everyoneDescription");
  if (option.type === "attachment") return format.fileSize(option.attachment.size);
  if (option.type === "skill") return skillDescription(option.skill);
  if (option.type === "mcp") return mcpServerDescription(option.server);
  if (option.type === "tab") return browserDisplayUrl(option.tab.url) || undefined;
  if (option.type === "thread") return threadDetail(option.thread);
  return option.agent.description.trim() || option.agent.title.trim() || undefined;
}

/** A tab that has no title yet shows its address. */
export function tabTitle(tab: ComposerBrowserTab): string {
  return tab.title.trim() || browserDisplayUrl(tab.url) || tab.url;
}

/** What a running thread does now, or why the last turn failed. */
function threadDetail(thread: ComposerThread): string | undefined {
  if (thread.state === "running") return thread.progress?.trim() || undefined;
  if (thread.outcome === "failed") return thread.error?.trim() || undefined;
  return undefined;
}

/* The words of the task list, so a thread has the same state in both places. */
const THREAD_STATE_LABELS = {
  running: "conversation.tasks.state.running",
  queued: "conversation.tasks.state.queued",
  new: "conversation.tasks.state.new",
  completed: "conversation.tasks.state.completed",
  failed: "conversation.tasks.state.failed",
  interrupted: "conversation.tasks.state.interrupted",
} as const satisfies Record<string, AppTextKey>;

function threadStateLabel(thread: ComposerThread): keyof typeof THREAD_STATE_LABELS {
  if (thread.state === "running" || thread.state === "queued") return thread.state;
  return thread.outcome ?? "new";
}

/**
 * How well a tab or a thread answers the `@` query: the title, and for a tab its address too.
 * Plain text, so the match marks show the same span.
 */
export function referenceMatches(option: { tab: ComposerBrowserTab } | { thread: ComposerThread }, query: string) {
  if (!query) return true;
  const text = "tab" in option ? `${tabTitle(option.tab)} ${browserDisplayUrl(option.tab.url)}` : option.thread.title;
  return text.toLocaleLowerCase().includes(query);
}

/** Where the server answers: the address for an http server, the command for a stdio one. */
function mcpServerDescription(server: ComposerMcpServer): string | undefined {
  const source = server.transport === "stdio" ? [server.command, ...server.args].join(" ") : server.url;
  return source.trim() || undefined;
}

/** Hangs the picker off the composer's top edge, inside the wrap the queue panel also sits in. */
export function measurePickerFrame(editor: HTMLElement): PickerFrame {
  const wrap = editor.closest(".composer-wrap");
  const composer = editor.closest(".composer");
  if (!(wrap instanceof HTMLElement) || !composer) return { mount: undefined, bottom: 0 };
  return { mount: wrap, bottom: wrap.getBoundingClientRect().bottom - composer.getBoundingClientRect().top };
}

/*
 * The badge carries the option type, and for a skill where it came from. Every row in a skill list
 * is a skill, so the badge names only the source.
 */
export function pickerOptionBadge(
  option: PickerOption,
  t: TextValue["t"],
): { label: string; icon?: typeof Puzzle } | null {
  // The section title says that a row is a tab, so a tab row needs no badge.
  if (option.type === "tab") return null;
  if (option.type === "thread") return { label: t(THREAD_STATE_LABELS[threadStateLabel(option.thread)]) };
  if (option.type === "agent") return { label: t("composer.picker.badge.agent"), icon: Bot };
  if (option.type === "everyone") return { label: t("composer.picker.badge.channel"), icon: UsersRound };
  if (option.type === "attachment") return { label: t("composer.picker.badge.file"), icon: File };
  if (option.type === "mcp") return { label: MCP_BADGE, icon: Plug };
  switch (option.skill.origin ?? "marketplace") {
    case "local":
      return { label: t("composer.picker.badge.custom"), icon: Folder };
    case "managed":
      return { label: t("composer.picker.badge.system"), icon: ShieldCheck };
    case "workspace":
      return { label: t("composer.picker.badge.workspace"), icon: Folder };
    default:
      return { label: t("composer.picker.badge.marketplace"), icon: Store };
  }
}

/** The protocol name. It is not translated. */
const MCP_BADGE = "MCP";

/**
 * How well a skill answers the query, lower first; null when it does not. A hit in the name
 * outranks one in the description, so the skill the user names is at the top.
 */
export function skillMatchRank(skill: ComposerSkill, query: string): number | null {
  if (!query) return 0;
  const name = skill.name.toLocaleLowerCase();
  const slug = skill.slug.toLocaleLowerCase();
  if (name === query || slug === query) return 0;
  if (name.startsWith(query) || slug.startsWith(query)) return 1;
  if (name.split(/[\s\-_]+/u).some((word) => word.startsWith(query))) return 2;
  if (name.includes(query) || slug.includes(query)) return 3;
  return skill.description?.toLocaleLowerCase().includes(query) ? 4 : null;
}

function skillDescription(skill: ComposerSkill): string | undefined {
  const description = skill.description?.trim();
  return description || undefined;
}
