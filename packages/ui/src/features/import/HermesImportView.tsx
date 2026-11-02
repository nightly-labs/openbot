import type {
  AgentImportResult,
  HermesImportItem,
  HermesImportItemKind,
  HermesImportPreview,
  HermesImportProfile,
  HermesImportReason,
} from "@openbot/contracts/ipc";
import type { AppFormat, AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  ArrowLeft,
  Badge,
  BookOpen,
  Brain,
  Button,
  CalendarClock,
  Checkbox,
  ChevronDown,
  FolderOpen,
  Lock,
  MessageCircle,
  Plug,
  Puzzle,
  SlidersHorizontal,
  SlidingTabs,
  TriangleAlert,
} from "@openbot/ui";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ImportResult } from "./AgentImportView";
import { HERMES_PATH } from "./hermes-logo-shape";

/**
 * `reading`: main reads the Hermes folder. `missing`: it found no profiles. `review`: the profiles are
 * open and nothing has changed. `importing`: agents are being made or updated. `done`: the result.
 */
export type HermesImportPhase = "reading" | "missing" | "review" | "importing" | "done";

/** One profile to import, with the items that need approval and that the user allows. */
export interface HermesImportSelection {
  key: string;
  allow: string[];
}

export interface HermesImportViewProps {
  phase: HermesImportPhase;
  preview: HermesImportPreview | null;
  result: AgentImportResult | null;
  /** Ids of the agents the import updated: profiles imported before. */
  updated?: ReadonlySet<string>;
  error?: string | null;
  onBack: () => void;
  onChooseFolder: () => void;
  onImport: (selection: HermesImportSelection[]) => void;
  onDone: () => void;
  onOpenAgent: (agentId: string) => void;
}

/** The Hermes Agent app icon: the portrait on a rounded tile. Light on a dark theme, dark on a light one. */
export function HermesLogo(props: { class?: string }) {
  return (
    <svg class={`hermes-logo ${props.class ?? ""}`} viewBox="0 0 1024 1024" aria-hidden="true">
      <rect class="hermes-logo-tile" width="1024" height="1024" rx="245" />
      <path class="hermes-logo-mark" d={HERMES_PATH} />
    </svg>
  );
}

/**
 * Server settings > Import > Hermes Agent. The review lists each profile as one agent, with every
 * item it holds and why an item needs approval or stays in Hermes, before anything changes.
 */
export function HermesImportView(props: HermesImportViewProps) {
  const { t, sourceText } = useText();
  return (
    <div
      class="storage-overview agent-import"
      aria-busy={props.phase === "reading" || props.phase === "importing" ? "true" : undefined}
    >
      <Show when={props.phase !== "done"}>
        <Button type="button" variant="ghost" size="sm" class="agent-import-back" onClick={() => props.onBack()}>
          <ArrowLeft aria-hidden="true" />
          {t("common.back")}
        </Button>
      </Show>
      <Show when={props.phase === "done" && props.result}>
        {(result) => (
          <ImportResult
            result={result()}
            updated={props.updated}
            onOpenAgent={props.onOpenAgent}
            onDone={props.onDone}
          />
        )}
      </Show>
      <Show when={props.phase === "reading" && !props.preview}>
        <p class="agent-import-step-note" role="status">
          {t("import.hermes.reading")}
        </p>
      </Show>
      <Show when={props.phase === "missing"}>
        <Show when={props.error}>
          <HermesAlert title={t("import.hermes.readFailed")} description={sourceText(props.error ?? "")} />
        </Show>
        <div class="storage-message">
          <TriangleAlert class="storage-message-icon" aria-hidden="true" />
          <div>
            <p class="storage-message-title">{t("import.hermes.notFound")}</p>
            <p class="storage-message-description">{t("import.hermes.notFoundNote")}</p>
          </div>
        </div>
        <Button type="button" variant="ghost" class="agent-import-picker" onClick={() => props.onChooseFolder()}>
          <FolderOpen class="agent-import-picker-icon" aria-hidden="true" />
          <span class="agent-import-picker-copy">
            <span class="agent-import-picker-title">{t("import.hermes.chooseFolder")}</span>
          </span>
        </Button>
      </Show>
      {/* Keyed, so a newly read folder starts with every profile selected again. */}
      <Show when={(props.phase === "review" || props.phase === "importing") && props.preview} keyed>
        {(preview) => (
          <HermesReview
            preview={preview}
            importing={props.phase === "importing"}
            error={props.error}
            onChooseFolder={props.onChooseFolder}
            onImport={props.onImport}
            onCancel={props.onBack}
          />
        )}
      </Show>
    </div>
  );
}

type RerunChoice = "update" | "leave";

function HermesReview(props: {
  preview: HermesImportPreview;
  importing: boolean;
  error?: string | null | undefined;
  onChooseFolder: () => void;
  onImport: (selection: HermesImportSelection[]) => void;
  onCancel: () => void;
}) {
  const { t, format, sourceText } = useText();
  const headingId = `hermes-import-${createUniqueId()}`;
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [allowed, setAllowed] = createSignal<ReadonlySet<string>>(new Set());
  const [left, setLeft] = createSignal<ReadonlySet<string>>(new Set());
  const [open, setOpen] = createSignal<ReadonlySet<string>>(new Set([props.preview.profiles[0]?.key ?? ""]));
  const included = createMemo(() =>
    props.preview.profiles.filter((profile) => !excluded().has(profile.key) && !left().has(profile.key)),
  );
  const updates = () => included().filter((profile) => profile.agent).length;
  const creates = () => included().length - updates();
  const allowKey = (profile: HermesImportProfile, item: HermesImportItem) => `${profile.key}\n${item.id}`;
  const actionLabel = () => {
    const agents = t("import.count.agent", { count: creates() });
    if (updates() === 0) return t("import.review.importAgents", { agents });
    if (creates() === 0) return t("import.hermes.updateAgents", { count: updates() });
    return t("import.hermes.importAndUpdate", { agents, updates: updates() });
  };
  const startImport = () =>
    props.onImport(
      included().map((profile) => ({
        key: profile.key,
        allow: profile.items
          .filter((item) => item.status === "approve" && allowed().has(allowKey(profile, item)))
          .map((item) => item.id),
      })),
    );

  return (
    <>
      <section class="storage-summary" aria-labelledby={`${headingId}-summary`}>
        <div class="storage-summary-heading">
          <div>
            <h3 id={`${headingId}-summary`} class="storage-summary-label agent-import-source-label">
              <HermesLogo class="agent-import-source-label-logo" />
              {t("import.hermes.title")}
            </h3>
            <p class="storage-summary-total">{t("import.hermes.profiles", { count: props.preview.profiles.length })}</p>
            <p class="storage-summary-caption">{t("import.hermes.caption", { path: props.preview.home })}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={props.importing}
            onClick={() => props.onChooseFolder()}
          >
            <FolderOpen class="files-button-icon" aria-hidden="true" />
            {t("import.hermes.chooseAnother")}
          </Button>
        </div>
      </section>

      <Show when={props.error}>
        <HermesAlert title={t("import.review.startFailed")} description={sourceText(props.error ?? "")} />
      </Show>

      <For each={props.preview.profiles}>
        {(profile) => {
          const isOpen = () => open().has(profile.key);
          const isIncluded = () => included().includes(profile);
          const itemsId = `${headingId}-${profile.key}-items`;
          return (
            <section class="storage-section agent-import-profile" aria-labelledby={`${headingId}-${profile.key}`}>
              <div class="agent-import-profile-head">
                <Checkbox
                  checked={!excluded().has(profile.key)}
                  disabled={props.importing}
                  aria-label={t("import.review.importItem", { name: profile.name })}
                  onChange={(event) => setExcluded(toggled(excluded(), profile.key, !event.currentTarget.checked))}
                />
                <AgentAvatar seed={`hermes-${profile.key}`} class="storage-row-avatar" />
                <span class="storage-row-copy">
                  <span class="agent-import-row-title">
                    <h4 id={`${headingId}-${profile.key}`} class="storage-row-title agent-import-profile-name">
                      {profile.name}
                    </h4>
                    <Show when={profile.agent}>
                      <Badge variant="info-light">{t("import.hermes.importedBefore")}</Badge>
                    </Show>
                  </span>
                  <span class="storage-row-meta">
                    {profile.model ? `${profile.path} · ${profile.model}` : profile.path}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={isOpen() ? "true" : "false"}
                  aria-controls={itemsId}
                  onClick={() => setOpen(toggled(open(), profile.key, !isOpen()))}
                >
                  {t("import.hermes.items", { count: profile.items.length })}
                  <ChevronDown
                    class={isOpen() ? "agent-import-chevron agent-import-chevron-open" : "agent-import-chevron"}
                    aria-hidden="true"
                  />
                </Button>
              </div>

              <Show when={profile.agent}>
                {(agent) => (
                  // A second import updates the agent it made before. It never adds another one.
                  <div class="agent-import-rerun">
                    <span class="agent-import-row-note">{t("import.hermes.rerunNote", { name: agent().name })}</span>
                    <SlidingTabs.Root
                      value={left().has(profile.key) ? "leave" : "update"}
                      onChange={(value) => setLeft(toggled(left(), profile.key, value === "leave"))}
                    >
                      <SlidingTabs.List aria-label={t("import.hermes.rerunLabel", { name: agent().name })}>
                        <SlidingTabs.Trigger
                          value={"update" satisfies RerunChoice}
                          disabled={props.importing}
                          aria-label={t("import.hermes.updateFor", { name: agent().name })}
                        >
                          {t("import.hermes.update")}
                        </SlidingTabs.Trigger>
                        <SlidingTabs.Trigger
                          value={"leave" satisfies RerunChoice}
                          disabled={props.importing}
                          aria-label={t("import.hermes.leaveFor", { name: agent().name })}
                        >
                          {t("import.hermes.leave")}
                        </SlidingTabs.Trigger>
                      </SlidingTabs.List>
                    </SlidingTabs.Root>
                  </div>
                )}
              </Show>

              <Show when={isOpen()}>
                <ul id={itemsId} class="storage-rows agent-import-items" data-muted={isIncluded() ? undefined : "true"}>
                  <For each={profile.items}>
                    {(item) => {
                      const Icon = ITEM_ICONS[item.kind];
                      const allowId = `${headingId}-${profile.key}-${item.id}`;
                      const detail = () => itemDetail(item, t, format);
                      return (
                        <li class="storage-row agent-import-row agent-import-item">
                          <Icon class="agent-import-card-icon" aria-hidden="true" />
                          <span class="storage-row-copy">
                            <span class="storage-row-title">{itemTitle(item, t)}</span>
                            <Show when={detail()}>
                              <span class="storage-row-meta">{detail()}</span>
                            </Show>
                            <Show when={item.reason}>
                              {(reason) => <span class="agent-import-row-note">{t(REASON_TEXT[reason()])}</span>}
                            </Show>
                          </span>
                          <Show
                            when={item.status === "approve"}
                            fallback={
                              <Badge variant={item.status === "ready" ? "success-light" : "outline"}>
                                {item.status === "ready" ? t("import.hermes.imports") : t("import.hermes.notImported")}
                              </Badge>
                            }
                          >
                            <label class="agent-import-allow" for={allowId}>
                              <Checkbox
                                id={allowId}
                                checked={allowed().has(allowKey(profile, item))}
                                disabled={props.importing || !isIncluded()}
                                aria-label={t("import.hermes.allowItem", { name: itemTitle(item, t) })}
                                onChange={(event) =>
                                  setAllowed(toggled(allowed(), allowKey(profile, item), event.currentTarget.checked))
                                }
                              />
                              {t("import.hermes.allow")}
                            </label>
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>
            </section>
          );
        }}
      </For>

      <div class="agent-import-actions">
        <Button type="button" variant="ghost" disabled={props.importing} onClick={() => props.onCancel()}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          disabled={included().length === 0}
          loading={props.importing}
          loadingLabel={t("import.review.importing")}
          onClick={startImport}
        >
          {actionLabel()}
        </Button>
      </div>
    </>
  );
}

const ITEM_ICONS: Record<HermesImportItemKind, typeof BookOpen> = {
  instructions: BookOpen,
  memories: Brain,
  skills: Puzzle,
  skill: Puzzle,
  builtInSkills: Puzzle,
  mcpServer: Plug,
  routines: CalendarClock,
  routine: CalendarClock,
  terminal: SlidersHorizontal,
  gateway: MessageCircle,
  secrets: Lock,
  history: MessageCircle,
};

const REASON_TEXT = {
  defaultSoul: "import.hermes.reason.defaultSoul",
  scripts: "import.hermes.reason.scripts",
  unsafeFile: "import.hermes.reason.unsafeFile",
  invalidSkill: "import.hermes.reason.invalidSkill",
  duplicateSkill: "import.hermes.reason.duplicateSkill",
  builtIn: "import.hermes.reason.builtIn",
  mcpOff: "import.hermes.reason.mcpOff",
  mcpNameTaken: "import.hermes.reason.mcpNameTaken",
  routineSchedule: "import.hermes.reason.routineSchedule",
  routineScript: "import.hermes.reason.routineScript",
  terminalBackend: "import.hermes.reason.terminalBackend",
  gateway: "import.hermes.reason.gateway",
  secrets: "import.hermes.reason.secrets",
  history: "import.hermes.reason.history",
} as const satisfies Record<HermesImportReason, AppTextKey>;

function itemTitle(item: HermesImportItem, t: AppTranslate): string {
  const name = item.names[0] ?? "";
  switch (item.kind) {
    case "instructions":
      return t("import.hermes.item.instructions");
    case "memories":
      return t("import.hermes.item.memories");
    case "skills":
      return t("import.count.skill", { count: item.count });
    case "builtInSkills":
      return t("import.hermes.item.builtInSkills", { count: item.count });
    case "mcpServer":
      return t("import.hermes.item.mcpServer", { name });
    case "routines":
      return t("import.count.routine", { count: item.count });
    case "terminal":
      return t("import.hermes.item.terminal", { name });
    case "gateway":
      return t("import.hermes.item.gateway", { names: item.names.join(", ") });
    case "secrets":
      return t("import.hermes.item.secrets", { count: item.count });
    case "history":
      return t("import.hermes.item.history");
    case "skill":
    case "routine":
      return name;
  }
}

function itemDetail(item: HermesImportItem, t: AppTranslate, format: AppFormat): string | null {
  switch (item.kind) {
    case "instructions":
      return item.status === "ready" ? t("import.hermes.item.instructionsDetail") : null;
    case "memories":
      return t("import.hermes.item.memoriesDetail", { count: item.count });
    case "skills":
      return t("import.hermes.item.skillsDetail", { names: format.list(item.names) });
    case "routines":
      return t("import.hermes.item.routinesDetail", { names: format.list(item.names) });
    case "secrets":
      return item.names.join(", ");
    default:
      return null;
  }
}

function HermesAlert(props: { title: string; description: string }) {
  return (
    <div class="storage-message" role="alert">
      <TriangleAlert class="storage-message-icon" aria-hidden="true" />
      <div>
        <p class="storage-message-title">{props.title}</p>
        <p class="storage-message-description">{props.description}</p>
      </div>
    </div>
  );
}

function toggled(set: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}
