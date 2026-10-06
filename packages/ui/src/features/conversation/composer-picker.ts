import type { DraftAttachment, InstalledSkill, McpServerConfig } from "@openbot/contracts/ipc";
import { Bot, File, Folder, Plug, type Puzzle, ShieldCheck, Store } from "@openbot/ui";
import type { AgentProfile } from "../../data";
import type { TextValue } from "../../text";

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
  | { type: "agent"; agent: AgentProfile }
  /** `showSlug` is set when another listed skill has the same name: the slug tells them apart. */
  | { type: "skill"; skill: InstalledSkill; showSlug: boolean }
  | { type: "mcp"; server: McpServerConfig }
  | { type: "attachment"; attachment: DraftAttachment };

export function pickerOptionKey(option: PickerOption): string {
  if (option.type === "agent") return `agent:${option.agent.id}`;
  if (option.type === "skill") return `skill:${option.skill.skillId}`;
  return option.type === "mcp" ? `mcp:${option.server.id}` : `attachment:${option.attachment.id}`;
}

export function pickerOptionText(option: PickerOption, t: TextValue["t"]): string {
  if (option.type === "agent") return t("composer.picker.option.agent", { name: option.agent.name });
  if (option.type === "skill") {
    const name = option.showSlug ? `${option.skill.name} ${option.skill.slug}` : option.skill.name;
    return t("composer.picker.option.skill", { name });
  }
  return option.type === "mcp"
    ? t("composer.picker.option.mcp", { name: option.server.name })
    : t("composer.picker.option.file", { name: option.attachment.name });
}

export function pickerOptionName(option: PickerOption): string {
  if (option.type === "agent") return option.agent.name;
  if (option.type === "skill") return option.skill.name;
  return option.type === "mcp" ? option.server.name : option.attachment.name;
}

export function pickerOptionDescription(option: PickerOption, format: TextValue["format"]): string | undefined {
  if (option.type === "attachment") return format.fileSize(option.attachment.size);
  if (option.type === "skill") return skillDescription(option.skill);
  if (option.type === "mcp") return mcpServerDescription(option.server);
  return option.agent.description.trim() || option.agent.title.trim() || undefined;
}

/** Where the server answers: the address for an http server, the command for a stdio one. */
function mcpServerDescription(server: McpServerConfig): string | undefined {
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
export function pickerOptionBadge(option: PickerOption, t: TextValue["t"]): { label: string; icon: typeof Puzzle } {
  if (option.type === "agent") return { label: t("composer.picker.badge.agent"), icon: Bot };
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
export function skillMatchRank(skill: InstalledSkill, query: string): number | null {
  if (!query) return 0;
  const name = skill.name.toLocaleLowerCase();
  const slug = skill.slug.toLocaleLowerCase();
  if (name === query || slug === query) return 0;
  if (name.startsWith(query) || slug.startsWith(query)) return 1;
  if (name.split(/[\s\-_]+/u).some((word) => word.startsWith(query))) return 2;
  if (name.includes(query) || slug.includes(query)) return 3;
  return skill.description?.toLocaleLowerCase().includes(query) ? 4 : null;
}

function skillDescription(skill: InstalledSkill): string | undefined {
  const description = skill.description?.trim();
  return description || undefined;
}
