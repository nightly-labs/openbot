import { type ChatTagKind, chatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { DraftAttachment, InstalledSkill, McpServerConfig } from "@openbot/contracts/ipc";
import { Blocks, Puzzle } from "@openbot/ui";
import { referenceChipClasses } from "@openbot/ui/reference-chip";
import { usesTouchLayout } from "@openbot/ui/utils";
import { createStaticAvatarSvg } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import { currentText } from "../../text";
import { appendAttachmentReferenceVisual } from "./AttachmentReference";

export const MENTION_PATTERN = /@\[([^\]]+)]\(([^)]+)\)/g;

export function truncateComposerValue(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let result = "";
  let cursor = 0;
  for (const match of value.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    const text = value.slice(cursor, index);
    if (result.length + text.length >= limit) {
      return result + text.slice(0, limit - result.length);
    }
    result += text;
    if (result.length + match[0].length > limit) return result;
    result += match[0];
    cursor = index + match[0].length;
  }
  return result + value.slice(cursor, cursor + limit - result.length);
}

export interface AttachmentTokenActions {
  tooltipId: string;
  open: (attachment: DraftAttachment, keepTooltip?: boolean) => void;
  showTooltip: (anchor: HTMLElement, content: string) => void;
  hideTooltip: (anchor: HTMLElement) => void;
  remove: (token: HTMLElement) => void;
}

export function createAttachmentToken(attachment: DraftAttachment, actions: AttachmentTokenActions): HTMLSpanElement {
  const token = document.createElement("span");
  token.className = "composer-file-reference";
  token.contentEditable = "false";
  token.dataset.attachmentReferenceId = attachment.id;
  token.dataset.attachmentReferenceName = attachment.name;
  token.setAttribute("role", "button");
  token.setAttribute("tabindex", "0");
  token.setAttribute("aria-label", currentText().t("composer.token.attachment", { name: attachment.name }));
  token.setAttribute("aria-describedby", actions.tooltipId);
  appendAttachmentReferenceVisual(token, attachment.name);
  const name = document.createElement("span");
  name.className = "inline-file-reference-name";
  name.textContent = attachment.name;
  token.append(name);
  const showTooltip = () => actions.showTooltip(token, attachment.name);
  const hideTooltip = () => actions.hideTooltip(token);
  token.addEventListener("pointerenter", showTooltip);
  token.addEventListener("pointerleave", hideTooltip);
  token.addEventListener("focus", showTooltip);
  token.addEventListener("blur", hideTooltip);
  token.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideTooltip();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      actions.remove(token);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    actions.open(attachment);
  });
  token.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (usesTouchLayout()) showTooltip();
    actions.open(attachment, usesTouchLayout());
  });
  return token;
}

export function createMentionToken(agent: AgentProfile): HTMLSpanElement {
  const token = document.createElement("span");
  token.className = `composer-mention-token ${referenceChipClasses.root}`;
  token.dataset.kind = "agent";
  token.title = agent.name;
  token.contentEditable = "false";
  token.dataset.mentionId = agent.id;
  token.dataset.mentionName = agent.name;
  token.setAttribute("aria-label", currentText().t("composer.token.agent", { name: agent.name }));
  const avatar = document.createElement("span");
  avatar.className = `composer-mention-avatar agent-avatar-motion-hover ${referenceChipClasses.icon}`;
  if (agent.avatarUrl) {
    const image = document.createElement("img");
    image.src = agent.avatarUrl;
    image.alt = "";
    image.draggable = false;
    image.addEventListener("error", () => {
      scheduleStaticMentionAvatar(avatar, agent);
    });
    avatar.append(image);
  } else {
    scheduleStaticMentionAvatar(avatar, agent);
  }
  const name = document.createElement("span");
  name.className = referenceChipClasses.name;
  name.textContent = agent.name;
  token.append(avatar, name);
  return token;
}

export function createSkillToken(skill: InstalledSkill): HTMLSpanElement {
  const token = document.createElement("span");
  updateSkillToken(token, skill);
  return token;
}

function updateSkillToken(token: HTMLSpanElement, skill: InstalledSkill): void {
  token.className = `composer-mention-token ${referenceChipClasses.root}`;
  token.dataset.kind = "skill";
  token.title = skill.name;
  token.contentEditable = "false";
  token.dataset.skillId = skill.skillId;
  token.dataset.skillName = skill.name;
  token.setAttribute("aria-label", currentText().t("composer.token.skill", { name: skill.name }));
  const iconWrap = document.createElement("span");
  iconWrap.className = referenceChipClasses.icon;
  iconWrap.setAttribute("aria-hidden", "true");
  const icon = Puzzle({ class: "skill-chip-glyph" });
  if (!(icon instanceof Node)) throw new Error("Puzzle icon did not render to a DOM node");
  iconWrap.append(icon);
  const name = document.createElement("span");
  name.className = referenceChipClasses.name;
  name.textContent = skill.name;
  token.replaceChildren(iconWrap, name);
}

export function createMcpToken(server: McpServerConfig): HTMLSpanElement {
  const token = document.createElement("span");
  updateMcpToken(token, server);
  return token;
}

function updateMcpToken(token: HTMLSpanElement, server: McpServerConfig): void {
  token.className = `composer-mention-token ${referenceChipClasses.root}`;
  token.dataset.kind = "mcp";
  token.title = server.name;
  token.contentEditable = "false";
  token.dataset.mcpId = server.id;
  token.dataset.mcpName = server.name;
  token.setAttribute("aria-label", currentText().t("composer.token.mcp", { name: server.name }));
  const iconWrap = document.createElement("span");
  iconWrap.className = referenceChipClasses.icon;
  iconWrap.setAttribute("aria-hidden", "true");
  const icon = Blocks({ class: "skill-chip-glyph" });
  if (!(icon instanceof Node)) throw new Error("Blocks icon did not render to a DOM node");
  iconWrap.append(icon);
  const name = document.createElement("span");
  name.className = referenceChipClasses.name;
  name.textContent = server.name;
  token.replaceChildren(iconWrap, name);
}

function createUnavailableTagToken(kind: ChatTagKind, id: string, name: string): HTMLSpanElement {
  const token = document.createElement("span");
  if (kind === "skill") {
    updateUnavailableSkillToken(token, id, name);
    return token;
  }
  if (kind === "mcp") {
    updateUnavailableMcpToken(token, id, name);
    return token;
  }
  token.className = "composer-mention-token composer-tag-unavailable";
  token.contentEditable = "false";
  token.dataset.mentionId = id;
  token.dataset.mentionName = name;
  token.setAttribute("aria-label", currentText().t("composer.token.unavailableAgent", { name }));
  token.textContent = name;
  return token;
}

function updateUnavailableSkillToken(token: HTMLSpanElement, id: string, name: string): void {
  token.className = "composer-mention-token composer-tag-unavailable";
  token.contentEditable = "false";
  token.dataset.skillId = id;
  token.dataset.skillName = name;
  token.setAttribute("aria-label", currentText().t("composer.token.unavailableSkill", { name }));
  token.textContent = name;
}

function updateUnavailableMcpToken(token: HTMLSpanElement, id: string, name: string): void {
  token.className = "composer-mention-token composer-tag-unavailable";
  token.contentEditable = "false";
  token.dataset.mcpId = id;
  token.dataset.mcpName = name;
  token.setAttribute("aria-label", currentText().t("composer.token.unavailableMcp", { name }));
  token.textContent = name;
}

/* A server the host no longer holds, or one the user turned off, is drawn as a name the agent
   cannot reach - the same outline a removed skill takes. */
export function syncMcpTokens(editor: HTMLDivElement, servers: McpServerConfig[]): void {
  const available = new Map(servers.filter((server) => server.enabled).map((server) => [server.id, server]));
  for (const token of editor.querySelectorAll<HTMLSpanElement>("[data-mcp-id]")) {
    const id = token.dataset.mcpId;
    if (!id) continue;
    const server = available.get(id);
    if (server) updateMcpToken(token, server);
    else updateUnavailableMcpToken(token, id, token.dataset.mcpName ?? "MCP server");
  }
}

export function syncSkillTokens(editor: HTMLDivElement, skills: InstalledSkill[]): void {
  const available = new Map(
    skills
      .filter((skill) => skill.state !== "needs-repair" && skill.enabled !== false)
      .map((skill) => [skill.skillId, skill]),
  );
  for (const token of editor.querySelectorAll<HTMLSpanElement>("[data-skill-id]")) {
    const id = token.dataset.skillId;
    if (!id) continue;
    const skill = available.get(id);
    if (skill) updateSkillToken(token, skill);
    else updateUnavailableSkillToken(token, id, token.dataset.skillName ?? "Skill");
  }
}

export function renderEditorValue(
  editor: HTMLDivElement,
  value: string,
  agents: AgentProfile[],
  skills: InstalledSkill[],
  mcpServers: McpServerConfig[],
  attachments: DraftAttachment[],
  attachmentTokenActions: AttachmentTokenActions,
) {
  editor.replaceChildren();
  let cursor = 0;
  for (const match of value.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) editor.append(document.createTextNode(value.slice(cursor, index)));
    const semanticReference = chatTagReferences(match[0])[0];
    const name = semanticReference?.name ?? match[1] ?? "Agent";
    const target = semanticReference ? `${semanticReference.kind}:${semanticReference.id}` : (match[2] ?? "");
    if (target.startsWith("attachment:")) {
      const id = target.slice("attachment:".length);
      const attachment = attachments.find((candidate) => candidate.id === id);
      editor.append(
        attachment ? createAttachmentToken(attachment, attachmentTokenActions) : document.createTextNode(name),
      );
      cursor = index + match[0].length;
      continue;
    }
    if (target.startsWith("skill:")) {
      const id = target.slice("skill:".length);
      const skill = skills.find(
        (candidate) => candidate.skillId === id && candidate.state !== "needs-repair" && candidate.enabled !== false,
      );
      editor.append(skill ? createSkillToken(skill) : createUnavailableTagToken("skill", id, name));
      cursor = index + match[0].length;
      continue;
    }
    if (target.startsWith("mcp:")) {
      const id = target.slice("mcp:".length);
      const server = mcpServers.find((candidate) => candidate.id === id && candidate.enabled);
      editor.append(server ? createMcpToken(server) : createUnavailableTagToken("mcp", id, name));
      cursor = index + match[0].length;
      continue;
    }
    const id = target.startsWith("agent:") ? target.slice("agent:".length) : target;
    const agent = agents.find((candidate) => candidate.id === id);
    editor.append(agent ? createMentionToken(agent) : createUnavailableTagToken("agent", id, name));
    cursor = index + match[0].length;
  }
  if (cursor < value.length) editor.append(document.createTextNode(value.slice(cursor)));
}

function scheduleStaticMentionAvatar(avatar: HTMLElement, agent: AgentProfile): void {
  queueMicrotask(() => {
    if (!avatar.isConnected) return;
    avatar.replaceChildren(createStaticAvatarSvg(agent.avatarSeed, agent.avatarHue));
  });
}
