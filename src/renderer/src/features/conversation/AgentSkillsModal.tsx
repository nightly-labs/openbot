import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { FilePreview, InstalledSkill, MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { assignedSkillCount, isFolderSkill, isSkillEnabled, userAssignedSkills } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import {
  Button,
  ChevronRight,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  Ellipsis,
  IconButton,
  SlidingTabs,
  Store,
  Switch,
  Trash2,
  X,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { SkillGlyph } from "@openbot/ui/features/conversation/SkillGlyph";
import { SkillLibraryToolbar } from "@openbot/ui/features/conversation/SkillLibraryToolbar";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { SkillPreview } from "../../components/SkillPreview";
import { type AgentSkillCalls, agentSkillCalls, type SkillCatalogCalls, skillsPort } from "../../skills-port";
import { LocalSkillsLibrary } from "./LocalSkillsLibrary";

/**
 * `mutable`: an agent on this computer. `host`: an agent on a joined server where this account is an
 * owner or admin; the host installs and removes, and its local skills library stays on the host.
 */
export type AgentSkillsMode = "mutable" | "host" | "readonly" | "hidden";

interface AgentSkillsModalProps {
  selectionRequest?: { skillId: string } | null | undefined;
  agentId: string;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCountChange: (count: number) => void;
  skillsMode?: AgentSkillsMode;
  /** The joined server that runs the agent. Read in `host` mode only. */
  serverId?: string | undefined;
  /** Replaces the desktop calls, for a client that reaches the host another way. */
  calls?: AgentSkillCalls | undefined;
  /** `null`: no marketplace catalog, so the list and details show only what the host sends. */
  catalog?: SkillCatalogCalls | null | undefined;
  onCreateSkill?: (() => void) | undefined;
  onTrySkill?: ((skill: SkillDetail) => void) | undefined;
  /** Reads a file in the agent workspace on the host, where a joined server keeps each skill's SKILL.md. */
  previewWorkspaceFile?: ((path: string) => Promise<FilePreview>) | undefined;
  onAddFromMarketplace?: ((agentId: string) => void) | undefined;
}

/** What the detail page shows: a marketplace or library entry, or the SKILL.md on the host. */
export type SkillDetail = Pick<
  MarketplaceSkillDetail,
  "id" | "name" | "description" | "iconUrl" | "instructions" | "examplePrompt" | "version"
>;

type ConfirmKind = "remove" | "replace";

interface ConfirmRequest {
  kind: ConfirmKind;
  skill: InstalledSkill;
}

export function AgentSkillsModal(props: AgentSkillsModalProps) {
  const { t, errorMessage, sourceText } = useText();
  const [skills, setSkills] = createSignal<InstalledSkill[]>([]);
  const [catalog, setCatalog] = createSignal<Record<string, { description: string; iconUrl: string | null }>>({});
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [detail, setDetail] = createSignal<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal("all");
  const libraryOpen = () => filter() === "local";
  const visibleSkills = createMemo(() => (filter() === "enabled" ? skills().filter(isSkillEnabled) : skills()));
  const [savingId, setSavingId] = createSignal<string | null>(null);
  const [confirm, setConfirm] = createSignal<ConfirmRequest | null>(null);
  const scrollFades = createScrollFades();
  let detailRequest = 0;
  let listRequest = 0;
  let modalContent: HTMLDivElement | undefined;
  let confirmationTrigger: HTMLButtonElement | undefined;
  const skillsMode = () => props.skillsMode ?? "mutable";
  const mutable = () => skillsMode() === "mutable" || skillsMode() === "host";
  /** The local skills library is on this computer, so only its own agents can use it. */
  const localLibrary = () => skillsMode() === "mutable";
  const calls = () => props.calls ?? agentSkillCalls(skillsMode() === "host" ? props.serverId : undefined);
  const catalogCalls = () => (props.catalog === undefined ? skillsPort().skills : props.catalog);
  const assignmentCount = createMemo(() => assignedSkillCount(skills()));
  const atCap = createMemo(() => assignmentCount() >= INPUT_LIMITS.agentSkills);
  const canAdd = createMemo(() => mutable() && !atCap() && props.onAddFromMarketplace !== undefined && !loading());
  /** A folder skill problem is English text from main. */
  const problemText = (skill: InstalledSkill) => (skill.problem === undefined ? undefined : sourceText(skill.problem));
  const selectedSkill = createMemo(() => {
    const id = selectedId();
    return id ? (skills().find((skill) => skill.skillId === id) ?? null) : null;
  });

  onSettled(() => scrollFades.stop);
  createEffect(
    () => [detail(), detailLoading(), selectedId(), visibleSkills()] as const,
    () => scrollFades.remeasure(),
  );

  async function loadSkills(showLoading = true): Promise<void> {
    const request = ++listRequest;
    const agentId = props.agentId;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const next = userAssignedSkills(
        skillsMode() === "readonly"
          ? await skillsPort().agent.listInstalledSkills(agentId)
          : await calls().listInstalled(agentId),
      );
      if (request !== listRequest || agentId !== props.agentId || !props.open) return;
      setSkills(next);
      props.onCountChange(assignedSkillCount(next));
      const targetId = props.selectionRequest?.skillId;
      if (showLoading && targetId) {
        const target = next.find((skill) => skill.skillId === targetId);
        if (target) await openDetail(target);
        else if (localLibrary()) setFilter("local");
      }
    } catch (caught) {
      if (request === listRequest) setError(errorMessage(caught, t("skill.loadFailed")));
    } finally {
      // The latest request ends the wait, also when it replaced a first load that showed it.
      if (request === listRequest) setLoading(false);
    }
  }

  // The agent object is new after each activity of the agent, and an effect runs again for an equal
  // value. The memos keep an open skill until the agent or the request changes.
  const agentId = createMemo(() => props.agentId);
  const selectionRequest = createMemo(() => props.selectionRequest);
  createEffect(
    () => [props.open, agentId(), skillsMode(), selectionRequest()] as const,
    ([open]) => {
      closeDetail();
      if (!open) {
        listRequest += 1;
        setConfirm(null);
        return;
      }
      setConfirm(null);
      setFilter("all");
      void untrack(() => loadSkills());
      void untrack(loadCatalog);
    },
  );

  // A change made on another device, in the chat or in another window shows while the dialog is open.
  createEffect(
    () => [props.open, props.agentId, calls()] as const,
    ([open, agentId, current]) => {
      if (!open || !current.onChanged) return;
      return current.onChanged((changedId) => {
        // During the first load, load in full again, so the skill the dialog was opened for still opens.
        if (changedId === agentId) void loadSkills(untrack(loading));
      });
    },
  );

  async function loadCatalog(): Promise<void> {
    const catalogPort = catalogCalls();
    if (!catalogPort) {
      setCatalog({});
      return;
    }
    try {
      const [marketplace, local] = await Promise.allSettled([
        catalogPort.list({ limit: 50 }),
        localLibrary() ? skillsPort().skills.localList() : Promise.resolve([]),
      ]);
      const page = {
        skills: [
          ...(marketplace.status === "fulfilled" ? marketplace.value.skills : []),
          ...(local.status === "fulfilled" ? local.value : []),
        ],
      };
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
    detailRequest += 1;
    setSelectedId(null);
    setDetail(null);
    setDetailLoading(false);
  }

  /** A joined server's skill shows the SKILL.md on the host, which is also right for a skill changed there. */
  function detailCall(skill: InstalledSkill): (() => Promise<SkillDetail>) | null {
    const catalogPort = catalogCalls();
    const local = skill.skillId.startsWith("local-skill-");
    const readHostFile = localLibrary() ? undefined : props.previewWorkspaceFile;
    if (readHostFile && (!isFolderSkill(skill) || skill.location)) {
      const listing = catalogPort && !local && !isFolderSkill(skill) ? () => catalogPort.get(skill.skillId) : null;
      return () => hostSkillDetail(skill, readHostFile, listing);
    }
    if (isFolderSkill(skill) || !catalogPort || (!localLibrary() && local)) return null;
    return local
      ? () => skillsPort().skills.localGet({ skillId: skill.skillId, revision: skill.installedVersion })
      : () => catalogPort.get(skill.skillId);
  }

  async function openDetail(skill: InstalledSkill): Promise<void> {
    const request = ++detailRequest;
    setSelectedId(skill.skillId);
    setDetail(null);
    setDetailLoading(true);
    setError(null);
    const load = detailCall(skill);
    if (!load) {
      setDetailLoading(false);
      return;
    }
    try {
      const next = await load();
      if (request === detailRequest) setDetail(next);
    } catch (caught) {
      if (request === detailRequest) setError(errorMessage(caught, t("skill.loadDetailsFailed")));
    } finally {
      if (request === detailRequest) setDetailLoading(false);
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

  async function setEnabled(skill: InstalledSkill, enabled: boolean): Promise<boolean> {
    const analytics = desktopAnalytics.scope();
    const action = enabled ? "enable" : "disable";
    let operationSucceeded = false;
    setSavingId(skill.skillId);
    setError(null);
    try {
      await calls().setEnabled({ agentId: props.agentId, skillId: skill.skillId, enabled });
      analytics.track("marketplace_action", { entity: "skill", action, result: "succeeded" });
      operationSucceeded = true;
      await loadSkills(false);
      return true;
    } catch (caught) {
      if (!operationSucceeded) {
        analytics.track("marketplace_action", {
          entity: "skill",
          action,
          result: "failed",
          failure_code: `${action}_failed`,
        });
      }
      setError(errorMessage(caught, enabled ? t("skill.enableFailed") : t("skill.disableFailed")));
      return false;
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
      await calls().uninstall({
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
      setError(errorMessage(caught, t("skill.removeFailed")));
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
      await calls().install({
        agentId: props.agentId,
        skillId: skill.skillId,
        ...(replaceModified ? { replaceModified: true } : {}),
      });
      analytics.track("marketplace_action", { entity: "skill", action: "update", result: "succeeded" });
      operationSucceeded = true;
      setConfirm(null);
      await loadSkills(false);
      const updated = skills().find((item) => item.skillId === skill.skillId);
      if (selectedId() === skill.skillId && updated) await openDetail(updated);
    } catch (caught) {
      if (!operationSucceeded) {
        analytics.track("marketplace_action", {
          entity: "skill",
          action: "update",
          result: "failed",
          failure_code: "update_failed",
        });
      }
      setError(errorMessage(caught, t("skill.updateFailed")));
    } finally {
      setSavingId(null);
    }
  }

  function runConfirmed(): Promise<void> | undefined {
    const request = confirm();
    if (!request) return;
    if (request.kind === "remove") return uninstall(request.skill, request.skill.state === "modified");
    return install(request.skill, request.skill.state === "modified");
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
            class="agent-memories-modal agent-skills-modal t-resize"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              modalContent?.focus({ preventScroll: true });
            }}
          >
            <header class="agent-memories-header">
              <div class="agent-memories-heading agent-skills-heading">
                <Show when={selectedSkill()} fallback={<Dialog.Title>{t("skill.title")}</Dialog.Title>}>
                  {(skill) => (
                    <>
                      <Button type="button" variant="ghost" class="agent-skills-parent" onClick={closeDetail}>
                        {t("skill.title")}
                      </Button>
                      <ChevronRight class="agent-skills-crumb" aria-hidden="true" />
                      <Dialog.Title>{skill().name}</Dialog.Title>
                    </>
                  )}
                </Show>
                <Dialog.Description class="sr-only">
                  {selectedSkill()
                    ? t("skill.detailsDescription", { name: selectedSkill()?.name ?? "" })
                    : t("skill.assignedDescription", { name: props.agentName })}
                </Dialog.Description>
              </div>
              <div class="agent-memories-header-actions">
                <Show when={selectedSkill()}>
                  {(skill) => (
                    <Show when={mutable() && !isFolderSkill(skill())}>
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
                        aria-label={t("skill.enableName", { name: skill().name })}
                        checked={isSkillEnabled(skill())}
                        disabled={savingId() === skill().skillId}
                        onChange={(enabled) => void setEnabled(skill(), enabled)}
                      />
                    </Show>
                  )}
                </Show>
                <Show when={!selectedSkill() && mutable()}>
                  <IconButton
                    label={t("skill.addFromMarketplace")}
                    variant="ghost"
                    disabled={!canAdd()}
                    onClick={addFromMarketplace}
                  >
                    <Store />
                  </IconButton>
                </Show>
                <IconButton label={t("skill.close")} variant="ghost" onClick={() => props.onOpenChange(false)}>
                  <X />
                </IconButton>
              </div>
            </header>

            <SlidingTabs.Root
              class="agent-memories-body agent-skills-tabs"
              value={filter()}
              onChange={(value) => setFilter(value)}
            >
              <Show when={!selectedSkill() && mutable()}>
                <SkillLibraryToolbar
                  localTab={localLibrary()}
                  canCreate={Boolean(props.onCreateSkill) && !atCap()}
                  onCreate={() => {
                    props.onCreateSkill?.();
                    props.onOpenChange(false);
                  }}
                />
              </Show>

              <SlidingTabs.ContentSlot class="agent-skills-tab-slot">
                <Show when={filter()} keyed>
                  {(selectedFilter) => (
                    <SlidingTabs.Content value={selectedFilter} class="agent-skills-tab-content">
                      <Show
                        when={!libraryOpen()}
                        fallback={
                          <LocalSkillsLibrary
                            initialSkillId={props.selectionRequest?.skillId}
                            agentId={props.agentId}
                            installed={skills()}
                            disabled={loading() || savingId() !== null}
                            onInstalled={async () => {
                              await loadSkills(false);
                              await loadCatalog();
                            }}
                            onTry={
                              props.onTrySkill
                                ? (skill) => {
                                    props.onTrySkill?.(skill);
                                    props.onOpenChange(false);
                                  }
                                : undefined
                            }
                          />
                        }
                      >
                        <Show when={mutable() && atCap()}>
                          <p class="agent-memory-limit" role="status">
                            {t("skill.limitReached", { limit: INPUT_LIMITS.agentSkills })}
                          </p>
                        </Show>
                        <Show when={skillsMode() === "readonly"}>
                          <p class="agent-memory-limit" role="status">
                            {t("skill.managedOnHost")}
                          </p>
                        </Show>
                        <Show when={!confirm() ? error() : null}>
                          {(message) => (
                            <p class="agent-memory-error" role="alert">
                              {message()}
                            </p>
                          )}
                        </Show>

                        <div class="t-page-slide agent-skills-pages" data-page={selectedSkill() ? "2" : "1"}>
                          <Show when={!loading()} fallback={<p class="agent-memory-state">{t("skill.loading")}</p>}>
                            <Show
                              when={selectedSkill()}
                              fallback={
                                <Show
                                  when={visibleSkills().length > 0}
                                  fallback={
                                    <div class="agent-skill-empty t-page" data-page-id="1">
                                      <p class="agent-memory-state">
                                        {filter() === "enabled" ? t("skill.emptyEnabled") : t("skill.emptyAssigned")}
                                      </p>
                                      <Show when={canAdd()}>
                                        <Button size="sm" onClick={addFromMarketplace}>
                                          {t("skill.addFromMarketplace")}
                                        </Button>
                                      </Show>
                                    </div>
                                  }
                                >
                                  <div
                                    ref={scrollFades.bind}
                                    class={["agent-memory-list", "agent-skill-rows", "t-page", scrollFades.classes()]}
                                    data-page-id="1"
                                    onScroll={scrollFades.measure}
                                  >
                                    <For each={visibleSkills()} keyed={(skill) => skill.skillId}>
                                      {(skill) => (
                                        <div
                                          class={
                                            isSkillEnabled(skill())
                                              ? "agent-skill-row"
                                              : "agent-skill-row agent-skill-row-disabled"
                                          }
                                        >
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            class="agent-skill-open"
                                            onClick={() => void openDetail(skill())}
                                          >
                                            <SkillGlyph iconUrl={catalog()[skill().skillId]?.iconUrl ?? null} />
                                            <div class="agent-skill-copy">
                                              <div class="agent-skill-title">
                                                <strong>{skill().name}</strong>
                                              </div>
                                              <small>
                                                {isFolderSkill(skill())
                                                  ? (problemText(skill()) ?? skill().description ?? skill().location)
                                                  : (catalog()[skill().skillId]?.description ?? skillMeta(skill(), t))}
                                              </small>
                                            </div>
                                          </Button>
                                          <Show when={mutable() && !isFolderSkill(skill())}>
                                            <Show when={skill().state === "update-available"}>
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                class="agent-skill-update"
                                                aria-label={t("skill.updateName", { name: skill().name })}
                                                disabled={savingId() !== null}
                                                onClick={() => void install(skill(), false)}
                                              >
                                                {t("skill.update")}
                                              </Button>
                                            </Show>
                                            <SkillMoreMenu
                                              skill={skill()}
                                              disabled={savingId() === skill().skillId}
                                              onUpdate={() =>
                                                skill().state === "modified"
                                                  ? requestReplace(skill())
                                                  : void install(skill(), false)
                                              }
                                              onRepair={() =>
                                                skill().state === "modified"
                                                  ? requestReplace(skill())
                                                  : void install(skill(), false)
                                              }
                                              onUninstall={() => requestRemove(skill())}
                                              triggerRef={(element) => {
                                                confirmationTrigger = element;
                                              }}
                                            />
                                            <Switch
                                              aria-label={t("skill.enableName", { name: skill().name })}
                                              checked={isSkillEnabled(skill())}
                                              disabled={savingId() === skill().skillId}
                                              onChange={(enabled) => void setEnabled(skill(), enabled)}
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
                                <div
                                  ref={scrollFades.bind}
                                  class={["agent-skill-detail", "t-page", scrollFades.classes()]}
                                  data-page-id="2"
                                  onScroll={scrollFades.measure}
                                >
                                  <Show when={isFolderSkill(skill())}>
                                    <Show when={skill().problem}>
                                      {(problem) => <p class="agent-memory-error">{sourceText(problem())}</p>}
                                    </Show>
                                    <Show when={!detail() && skill().description}>
                                      {(description) => <p class="agent-memory-state">{description()}</p>}
                                    </Show>
                                    <p class="agent-memory-state">
                                      {t("skill.folderSkill", { location: skill().location ?? "" })}
                                    </p>
                                  </Show>
                                  <Show
                                    when={!catalogCalls() && !isFolderSkill(skill()) && !detail() && !detailLoading()}
                                  >
                                    <p class="agent-memory-state">{skill().description ?? skillMeta(skill(), t)}</p>
                                  </Show>
                                  <Show when={detailLoading()}>
                                    <p class="agent-memory-state">{t("skill.loadingDetails")}</p>
                                  </Show>
                                  <Show when={detail()}>
                                    {(current) => (
                                      <SkillPreview
                                        skill={current()}
                                        onTry={
                                          mutable() &&
                                          skill().state !== "needs-repair" &&
                                          skill().installedVersion === current().version &&
                                          savingId() !== skill().skillId &&
                                          props.onTrySkill
                                            ? async () => {
                                                const selected = skill();
                                                const preview = current();
                                                const agentId = props.agentId;
                                                if (!isSkillEnabled(selected) && !(await setEnabled(selected, true)))
                                                  return;
                                                if (
                                                  !props.open ||
                                                  props.agentId !== agentId ||
                                                  selectedId() !== selected.skillId
                                                )
                                                  return;
                                                props.onTrySkill?.(preview);
                                                props.onOpenChange(false);
                                              }
                                            : undefined
                                        }
                                        // The conditions on `onTry` above, in the same order: a
                                        // save in flight reads as an unavailable composer without
                                        // this, which names the wrong cause.
                                        unavailableReason={
                                          !mutable()
                                            ? t("skill.unavailable.readOnly")
                                            : skill().state === "needs-repair"
                                              ? t("skill.unavailable.repair")
                                              : skill().installedVersion !== current().version
                                                ? t("skill.unavailable.updateVersion")
                                                : savingId() === skill().skillId
                                                  ? t("skill.unavailable.saving")
                                                  : t("skill.unavailable.composer")
                                        }
                                      />
                                    )}
                                  </Show>
                                </div>
                              )}
                            </Show>
                          </Show>
                        </div>
                      </Show>
                    </SlidingTabs.Content>
                  )}
                </Show>
              </SlidingTabs.ContentSlot>
            </SlidingTabs.Root>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={confirm() !== null}
        onCancel={cancelConfirm}
        onConfirm={runConfirmed}
        title={confirmTitle(confirm(), t)}
        description={confirmBody(confirm(), t)}
        tone={confirm()?.kind === "replace" ? "default" : "destructive"}
        confirmLabel={confirmConfirm(confirm(), t)}
        pending={savingId() !== null}
        error={error()}
        initialFocus="cancel"
      />
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
  const { t } = useText();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class="agent-skill-more"
        aria-label={t("skill.moreFor", { name: props.skill.name })}
        disabled={props.disabled}
        ref={props.triggerRef}
      >
        <Ellipsis />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-skill-menu">
          <Show when={props.skill.state === "update-available"}>
            <DropdownMenu.Item onSelect={props.onUpdate}>{t("skill.update")}</DropdownMenu.Item>
          </Show>
          <Show when={props.skill.state === "needs-repair" || props.skill.state === "modified"}>
            <DropdownMenu.Item onSelect={props.onRepair}>{t("skill.repair")}</DropdownMenu.Item>
          </Show>
          <DropdownMenu.Item class="ui-action-menu-danger" onSelect={props.onUninstall}>
            <Trash2 />
            {t("skill.uninstall")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Where the host keeps the skill's SKILL.md, relative to the agent workspace, in the order to read. */
function hostSkillPaths(skill: InstalledSkill): string[] {
  if (isFolderSkill(skill)) return [`${skill.location}/SKILL.md`];
  if (!isSkillEnabled(skill)) return [`.openbot/skills-disabled/${skill.slug}/SKILL.md`];
  // The host writes a copy to each managed skill folder.
  return [".agents/skills", ".claude/skills"].map((folder) => `${folder}/${skill.slug}/SKILL.md`);
}

/**
 * The SKILL.md on the host. A marketplace entry adds its icon and example prompt, and shows in its
 * place when the host cannot send the file.
 */
async function hostSkillDetail(
  skill: InstalledSkill,
  readHostFile: (path: string) => Promise<FilePreview>,
  listing: (() => Promise<SkillDetail>) | null,
): Promise<SkillDetail> {
  const pendingEntry = listing?.().catch(() => null) ?? Promise.resolve(null);
  let file: FilePreview | null = null;
  let failure: unknown;
  for (const path of hostSkillPaths(skill)) {
    try {
      file = await readHostFile(path);
      break;
    } catch (error) {
      failure ??= error;
    }
  }
  const entry = await pendingEntry;
  if (!file) {
    if (entry) return entry;
    throw failure;
  }
  const text = file.bytes ? new TextDecoder().decode(file.bytes) : "";
  return {
    id: skill.skillId,
    name: skill.name,
    description: skill.description ?? entry?.description ?? "",
    iconUrl: entry?.iconUrl ?? null,
    ...(entry?.examplePrompt ? { examplePrompt: entry.examplePrompt } : {}),
    instructions: text.replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "").trim(),
    version: skill.installedVersion,
  };
}

function skillMeta(skill: InstalledSkill, t: AppTranslate): string {
  if (skill.state === "update-available") {
    return t("skill.versionUpdate", { installed: skill.installedVersion, available: skill.availableVersion ?? "" });
  }
  return t("skill.version", { version: skill.installedVersion });
}

function confirmTitle(request: ConfirmRequest | null, t: AppTranslate) {
  if (!request) return "";
  if (request.kind === "replace") return t("skill.confirm.replaceTitle");
  return t("skill.confirm.removeTitle");
}

function confirmBody(request: ConfirmRequest | null, t: AppTranslate) {
  if (!request) return "";
  if (request.kind === "replace") return t("skill.confirm.replaceBody");
  if (request.skill.state === "modified") return t("skill.confirm.removeModifiedBody");
  return t("skill.confirm.removeBody");
}

function confirmConfirm(request: ConfirmRequest | null, t: AppTranslate) {
  if (request?.kind === "replace") return t("skill.confirm.replace");
  return t("skill.confirm.remove");
}
