import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { InstalledSkill, MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { createScrollFades } from "../../components/createScrollFades";
import {
  Button,
  ChevronRight,
  Dialog,
  DropdownMenu,
  Ellipsis,
  IconButton,
  Puzzle,
  Switch,
  Trash2,
  X,
} from "../../components/ui";
import { errorMessage } from "../../error-message";

export type AgentSkillsMode = "mutable" | "readonly" | "hidden";

interface AgentSkillsModalProps {
  agentId: string;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCountChange: (count: number) => void;
  skillsMode?: AgentSkillsMode;
  onAddFromMarketplace?: (agentId: string) => void;
}

type ConfirmKind = "remove" | "replace";

interface ConfirmRequest {
  kind: ConfirmKind;
  skill: InstalledSkill;
}

export function AgentSkillsModal(props: AgentSkillsModalProps) {
  const [skills, setSkills] = createSignal<InstalledSkill[]>([]);
  const [catalog, setCatalog] = createSignal<Record<string, { description: string; iconUrl: string | null }>>({});
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [detail, setDetail] = createSignal<MarketplaceSkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [savingId, setSavingId] = createSignal<string | null>(null);
  const [confirm, setConfirm] = createSignal<ConfirmRequest | null>(null);
  const scrollFades = createScrollFades();
  let modalContent: HTMLDivElement | undefined;
  let confirmationTrigger: HTMLButtonElement | undefined;
  const skillsMode = () => props.skillsMode ?? "mutable";
  const mutable = () => skillsMode() === "mutable";
  const assignmentCount = createMemo(() => skills().length);
  const atCap = createMemo(() => assignmentCount() >= INPUT_LIMITS.agentSkills);
  const canAdd = createMemo(() => mutable() && !atCap() && props.onAddFromMarketplace !== undefined && !loading());
  const selectedSkill = createMemo(() => {
    const id = selectedId();
    return id ? (skills().find((skill) => skill.skillId === id) ?? null) : null;
  });

  onSettled(() => scrollFades.stop);

  async function loadSkills(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const next = userAssignedSkills(
        skillsMode() === "readonly"
          ? await window.openbot.agent.listInstalledSkills(props.agentId)
          : await window.openbot.skills.listInstalled(props.agentId),
      );
      setSkills(next);
      props.onCountChange(next.length);
    } catch (caught) {
      setError(errorMessage(caught, "Could not load skills."));
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  createEffect(
    () => [props.open, props.agentId, skillsMode()] as const,
    ([open]) => {
      if (!open) {
        closeDetail();
        setConfirm(null);
        return;
      }
      setConfirm(null);
      void loadSkills();
      void loadCatalog();
    },
  );

  async function loadCatalog(): Promise<void> {
    try {
      const page = await window.openbot.skills.list({ limit: 50 });
      const hints: Record<string, { description: string; iconUrl: string | null }> = {};
      for (const skill of page.skills) {
        hints[skill.id] = { description: skill.description, iconUrl: skill.iconUrl };
      }
      setCatalog(hints);
    } catch {
      setCatalog({});
    }
  }

  function closeDetail(): void {
    setSelectedId(null);
    setDetail(null);
    setDetailLoading(false);
  }

  async function openDetail(skill: InstalledSkill): Promise<void> {
    setSelectedId(skill.skillId);
    setDetail(null);
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(await window.openbot.skills.get(skill.skillId));
    } catch (caught) {
      setError(errorMessage(caught, "Could not load skill details."));
    } finally {
      setDetailLoading(false);
    }
  }

  function addFromMarketplace(): void {
    if (!canAdd() || !props.onAddFromMarketplace) return;
    props.onAddFromMarketplace(props.agentId);
  }

  function requestRemove(skill: InstalledSkill): void {
    setConfirm({ kind: "remove", skill });
  }

  function requestReplace(skill: InstalledSkill): void {
    setConfirm({ kind: "replace", skill });
  }

  async function setEnabled(skill: InstalledSkill, enabled: boolean): Promise<void> {
    const analytics = desktopAnalytics.scope();
    const action = enabled ? "enable" : "disable";
    let operationSucceeded = false;
    setSavingId(skill.skillId);
    setError(null);
    try {
      await window.openbot.skills.setEnabled({ agentId: props.agentId, skillId: skill.skillId, enabled });
      analytics.track("marketplace_action", { entity: "skill", action, result: "succeeded" });
      operationSucceeded = true;
      await loadSkills(false);
    } catch (caught) {
      if (!operationSucceeded) {
        analytics.track("marketplace_action", {
          entity: "skill",
          action,
          result: "failed",
          failure_code: `${action}_failed`,
        });
      }
      setError(errorMessage(caught, enabled ? "Could not enable the skill." : "Could not disable the skill."));
    } finally {
      setSavingId(null);
    }
  }

  async function uninstall(skill: InstalledSkill, removeModified: boolean): Promise<void> {
    const analytics = desktopAnalytics.scope();
    let operationSucceeded = false;
    setSavingId(skill.skillId);
    setError(null);
    try {
      await window.openbot.skills.uninstall({
        agentId: props.agentId,
        skillId: skill.skillId,
        ...(removeModified ? { removeModified: true } : {}),
      });
      analytics.track("marketplace_action", { entity: "skill", action: "uninstall", result: "succeeded" });
      operationSucceeded = true;
      setConfirm(null);
      if (selectedId() === skill.skillId) closeDetail();
      await loadSkills(false);
    } catch (caught) {
      if (!operationSucceeded) {
        analytics.track("marketplace_action", {
          entity: "skill",
          action: "uninstall",
          result: "failed",
          failure_code: "uninstall_failed",
        });
      }
      setError(errorMessage(caught, "Could not remove the skill."));
    } finally {
      setSavingId(null);
    }
  }

  async function install(skill: InstalledSkill, replaceModified: boolean): Promise<void> {
    const analytics = desktopAnalytics.scope();
    let operationSucceeded = false;
    setSavingId(skill.skillId);
    setError(null);
    try {
      await window.openbot.skills.install({
        agentId: props.agentId,
        skillId: skill.skillId,
        ...(replaceModified ? { replaceModified: true } : {}),
      });
      analytics.track("marketplace_action", { entity: "skill", action: "update", result: "succeeded" });
      operationSucceeded = true;
      setConfirm(null);
      await loadSkills(false);
    } catch (caught) {
      if (!operationSucceeded) {
        analytics.track("marketplace_action", {
          entity: "skill",
          action: "update",
          result: "failed",
          failure_code: "update_failed",
        });
      }
      setError(errorMessage(caught, "Could not update the skill."));
    } finally {
      setSavingId(null);
    }
  }

  function runConfirmed(): void {
    const request = confirm();
    if (!request) return;
    if (request.kind === "remove") {
      void uninstall(request.skill, request.skill.state === "modified");
      return;
    }
    void install(request.skill, request.skill.state === "modified");
  }

  function cancelConfirm(): void {
    if (savingId()) return;
    setConfirm(null);
    queueMicrotask(() => confirmationTrigger?.focus());
  }

  return (
    <>
      <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay class="agent-memories-overlay" />
          <Dialog.Content
            ref={(element) => (modalContent = element)}
            class="agent-memories-modal agent-skills-modal"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              modalContent?.focus({ preventScroll: true });
            }}
          >
            <header class="agent-memories-header">
              <div class="agent-memories-heading agent-skills-heading">
                <Show when={selectedSkill()} fallback={<Dialog.Title>Skills</Dialog.Title>}>
                  {(skill) => (
                    <>
                      <Button type="button" variant="ghost" class="agent-skills-parent" onClick={closeDetail}>
                        Skills
                      </Button>
                      <ChevronRight class="agent-skills-crumb" aria-hidden="true" />
                      <Dialog.Title>{skill().name}</Dialog.Title>
                    </>
                  )}
                </Show>
                <Dialog.Description class="sr-only">
                  {selectedSkill() ? `${selectedSkill()?.name} details` : `Assigned skills for ${props.agentName}`}
                </Dialog.Description>
              </div>
              <div class="agent-memories-header-actions">
                <Show when={selectedSkill()}>
                  {(skill) => (
                    <Show when={mutable()}>
                      <SkillMoreMenu
                        skill={skill()}
                        disabled={savingId() === skill().skillId}
                        onUpdate={() =>
                          skill().state === "modified" ? requestReplace(skill()) : void install(skill(), false)
                        }
                        onRepair={() =>
                          skill().state === "modified" ? requestReplace(skill()) : void install(skill(), false)
                        }
                        onUninstall={() => requestRemove(skill())}
                      />
                      <Switch
                        aria-label={`Enable ${skill().name}`}
                        checked={isEnabled(skill())}
                        disabled={savingId() === skill().skillId}
                        onChange={(enabled) => void setEnabled(skill(), enabled)}
                      />
                    </Show>
                  )}
                </Show>
                <Show when={!selectedSkill() && mutable()}>
                  <Button size="sm" variant="ghost" disabled={!canAdd()} onClick={addFromMarketplace}>
                    Add from marketplace
                  </Button>
                </Show>
                <IconButton label="Close skills" variant="ghost" onClick={() => props.onOpenChange(false)}>
                  <X />
                </IconButton>
              </div>
            </header>

            <div class="agent-memories-body">
              <Show when={mutable() && atCap()}>
                <p class="agent-memory-limit" role="status">
                  This agent has reached the limit of {INPUT_LIMITS.agentSkills} skills. Remove a skill before you add
                  another one.
                </p>
              </Show>
              <Show when={skillsMode() === "readonly"}>
                <p class="agent-memory-limit" role="status">
                  Skills for this agent are managed on the host.
                </p>
              </Show>
              <Show when={!confirm() ? error() : null}>
                {(message) => (
                  <p class="agent-memory-error" role="alert">
                    {message()}
                  </p>
                )}
              </Show>

              <Show when={!loading()} fallback={<p class="agent-memory-state">Loading skills…</p>}>
                <Show
                  when={selectedSkill()}
                  fallback={
                    <Show
                      when={skills().length > 0}
                      fallback={
                        <div class="agent-skill-empty">
                          <p class="agent-memory-state">This agent has no assigned skills yet.</p>
                          <Show when={canAdd()}>
                            <Button size="sm" onClick={addFromMarketplace}>
                              Add from marketplace
                            </Button>
                          </Show>
                        </div>
                      }
                    >
                      <div
                        ref={scrollFades.bind}
                        class={["agent-memory-list", "agent-skill-rows", scrollFades.classes()]}
                        onScroll={scrollFades.measure}
                      >
                        <For each={skills()}>
                          {(skill) => (
                            <div
                              class={isEnabled(skill) ? "agent-skill-row" : "agent-skill-row agent-skill-row-disabled"}
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                class="agent-skill-open"
                                onClick={() => void openDetail(skill)}
                              >
                                <SkillGlyph iconUrl={catalog()[skill.skillId]?.iconUrl ?? null} />
                                <div class="agent-skill-copy">
                                  <div class="agent-skill-title">
                                    <strong>{skill.name}</strong>
                                    <Show when={stateLabel(skill.state)}>
                                      {(label) => <span class="agent-skill-tag">{label()}</span>}
                                    </Show>
                                  </div>
                                  <small>{catalog()[skill.skillId]?.description ?? skillMeta(skill)}</small>
                                </div>
                              </Button>
                              <Show when={mutable()}>
                                <SkillMoreMenu
                                  skill={skill}
                                  disabled={savingId() === skill.skillId}
                                  onUpdate={() =>
                                    skill.state === "modified" ? requestReplace(skill) : void install(skill, false)
                                  }
                                  onRepair={() =>
                                    skill.state === "modified" ? requestReplace(skill) : void install(skill, false)
                                  }
                                  onUninstall={() => requestRemove(skill)}
                                  triggerRef={(element) => {
                                    confirmationTrigger = element;
                                  }}
                                />
                                <Switch
                                  aria-label={`Enable ${skill.name}`}
                                  checked={isEnabled(skill)}
                                  disabled={savingId() === skill.skillId}
                                  onChange={(enabled) => void setEnabled(skill, enabled)}
                                />
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  }
                >
                  {(skill) => (
                    <div class="agent-skill-detail">
                      <p class="agent-skill-detail-lead">
                        {detail()?.description ?? catalog()[skill().skillId]?.description ?? skillMeta(skill())}
                      </p>
                      <Show when={detailLoading()} fallback={null}>
                        <p class="agent-memory-state">Loading details…</p>
                      </Show>
                      <Show when={detail()}>
                        {(current) => (
                          <>
                            <div class="agent-skill-detail-body">{displayInstructions(current())}</div>
                            <p class="agent-skill-detail-meta">
                              Version {skill().installedVersion}
                              {current().files.length > 0 ? ` · ${current().files.length} files` : ""}
                            </p>
                          </>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>
              </Show>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={confirm() !== null}
        onOpenChange={(open) => {
          if (!open) cancelConfirm();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="agent-memory-confirm-overlay" />
          <Dialog.Content class="agent-memory-confirm-dialog">
            <div class="agent-memory-confirm-content">
              <Dialog.Title>{confirmTitle(confirm())}</Dialog.Title>
              <Dialog.Description>{confirmBody(confirm())}</Dialog.Description>
              <Show when={error()}>
                {(message) => (
                  <p class="agent-memory-error" role="alert">
                    {message()}
                  </p>
                )}
              </Show>
              <div class="agent-memory-confirm-actions">
                <Button variant="ghost" disabled={savingId() !== null} onClick={cancelConfirm}>
                  Cancel
                </Button>
                <Button
                  variant={confirm()?.kind === "remove" ? "destructive" : "default"}
                  loading={savingId() !== null}
                  onClick={runConfirmed}
                >
                  {confirmConfirm(confirm())}
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function SkillMoreMenu(props: {
  skill: InstalledSkill;
  disabled: boolean;
  onUpdate: () => void;
  onRepair: () => void;
  onUninstall: () => void;
  triggerRef?: (element: HTMLButtonElement) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class="agent-skill-more"
        aria-label={`More for ${props.skill.name}`}
        disabled={props.disabled}
        ref={props.triggerRef}
      >
        <Ellipsis />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-skill-menu">
          <Show when={props.skill.state === "update-available"}>
            <DropdownMenu.Item onSelect={props.onUpdate}>Update</DropdownMenu.Item>
          </Show>
          <Show when={props.skill.state === "needs-repair"}>
            <DropdownMenu.Item onSelect={props.onRepair}>Repair</DropdownMenu.Item>
          </Show>
          <DropdownMenu.Item class="ui-action-menu-danger" onSelect={props.onUninstall}>
            <Trash2 />
            Uninstall
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SkillGlyph(props: { iconUrl: string | null }) {
  const [failedUrl, setFailedUrl] = createSignal<string | null>(null);
  const iconUrl = () => (props.iconUrl && failedUrl() !== props.iconUrl ? props.iconUrl : null);

  return (
    <span class="agent-skill-icon" aria-hidden="true">
      <Show when={iconUrl()} fallback={<Puzzle />} keyed>
        {(url) => <img src={url} alt="" onError={() => setFailedUrl(url)} />}
      </Show>
    </span>
  );
}

function isBuiltInSkill(skill: InstalledSkill): boolean {
  return (
    skill.origin === "managed" || skill.slug === "openbot-site-hosting" || skill.skillId === "openbot-site-hosting"
  );
}

function isEnabled(skill: InstalledSkill): boolean {
  return skill.enabled !== false;
}

export function userAssignedSkills(skills: InstalledSkill[]): InstalledSkill[] {
  return skills
    .filter((skill) => !isBuiltInSkill(skill))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
}

function stateLabel(state: InstalledSkill["state"]) {
  if (state === "update-available") return "Update available";
  if (state === "modified") return "Local changes";
  if (state === "needs-repair") return "Needs repair";
  return null;
}

function skillMeta(skill: InstalledSkill): string {
  if (skill.state === "update-available") return `v${skill.installedVersion} · v${skill.availableVersion} available`;
  return `v${skill.installedVersion}`;
}

function displayInstructions(skill: MarketplaceSkillDetail): string {
  const instructions = skill.instructions || skill.description;
  const [firstLine, ...remaining] = instructions.split(/\r?\n/u);
  if (firstLine?.replace(/^#\s+/u, "").trim() === skill.name) return remaining.join("\n").trim();
  return instructions;
}

function confirmTitle(request: ConfirmRequest | null) {
  if (!request) return "";
  if (request.kind === "replace") return "Replace local changes?";
  return "Remove this skill?";
}

function confirmBody(request: ConfirmRequest | null) {
  if (!request) return "";
  if (request.kind === "replace") {
    return "Updating this skill replaces the local files with the marketplace package. Your edits in this skill folder will be lost.";
  }
  if (request.skill.state === "modified") {
    return "This skill has local changes in the agent workspace. Remove deletes those files. Original chat messages stay.";
  }
  return "OpenBot will remove this skill from the agent. Chat history stays.";
}

function confirmConfirm(request: ConfirmRequest | null) {
  if (request?.kind === "replace") return "Replace skill";
  return "Remove skill";
}
