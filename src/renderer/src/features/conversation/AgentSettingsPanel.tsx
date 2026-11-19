import {
  type AgentBrowserProfile,
  agentAutomationAllowed,
  agentNotificationLevelMap,
  type BrowserProfileSummary,
  type BrowserProxyComputer,
  type BrowserProxySummary,
  DEFAULT_AGENT_DEFAULTS,
  type FilePreview,
  type ServerNotificationLevel,
  type TestRoutineInput,
  userAssignedSkills,
} from "@openbot/contracts/ipc";
import { Blocks, BookMarked, CalendarClock, FileText, Folder, Gauge, Puzzle, Table2, Upload } from "@openbot/ui";
import { SettingsLinkGroup, SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import type { AgentProfile } from "@openbot/ui/data";
import type { BrowserProfileSelectProfile } from "@openbot/ui/features/browser/BrowserProfileSelect";
import { browserProfileProxyNames } from "@openbot/ui/features/browser/BrowserProxies";
import {
  type AgentInstructionsCalls,
  AgentInstructionsView,
} from "@openbot/ui/features/conversation/AgentInstructionsView";
import {
  AgentSessionSettings,
  type AgentSessionSettingsApi,
} from "@openbot/ui/features/conversation/AgentSessionSettings";
import SharedAgentSettingsPanel, {
  type AgentBrowserProfileOptions,
  type AgentNotificationLevelOptions,
  type AgentSettingsPanelProps as SharedAgentSettingsPanelProps,
} from "@openbot/ui/features/conversation/AgentSettingsPanel";
import type { AgentSettingLinkId, AgentSettingReveal } from "@openbot/ui/features/conversation/agent-setting-links";
import { agentFilesLinkValue } from "@openbot/ui/features/files/AgentFilesView";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { createSidePanelWidth, readSidePanelWidth, saveSidePanelWidth } from "../../components/side-panel-width";
import type { SkillCatalogCalls } from "../../skills-port";
import { agentSkillCalls, skillsPort } from "../../skills-port";
import type { BrowserProfileCalls } from "../browser/browser-profiles-port";
import { createBrowserProfilesStore } from "../browser/stores/browser-profiles-store";
import { type AgentFilesOptions, AgentFilesSettings } from "../files/AgentFilesSettings";
import { filesPort } from "../files/files-port";
import { createStorageUsage } from "../files/storage-usage";
import { AgentMemoriesSettings } from "./AgentMemoriesSettings";
import { AgentRoutinesSettings, type DetailLeaveGuard, type RoutineSelectionRequest } from "./AgentRoutinesSettings";
import { AgentSkillsModal, type AgentSkillsMode, type SkillDetail } from "./AgentSkillsModal";
import { conversationPort, type SharedTableCalls } from "./conversation-port";
import type { AgentNotificationLevelCalls, ConversationRuntime } from "./conversation-runtime";
import { type AgentMemoriesApi, agentMemoriesPort, type MemoriesPort } from "./memories-port";
import type { EventRoutinesApi } from "./routine-webhooks-api";
import {
  type AgentRoutinesApi,
  agentRoutinesPort,
  eventRoutinesPort,
  type RoutineResultsCalls,
  type RoutinesPort,
} from "./routines-port";
import { SharedTablesModal } from "./SharedTablesModal";

interface AgentSettingsPanelProps
  extends Omit<
    SharedAgentSettingsPanelProps,
    | "width"
    | "onResize"
    | "onResizeEnd"
    | "links"
    | "detailOpen"
    | "children"
    | "browserProfiles"
    | "notificationLevel"
    | "reveal"
  > {
  remoteClient?: boolean;
  skillCatalog?: SkillCatalogCalls | undefined;
  localHost?: boolean;
  sessionSettingsEditable?: boolean;
  memoryLimit?: number | undefined;
  adminCalls?: ConversationRuntime["admin"] | undefined;
  onPublish?: (() => void) | undefined;
  onOpenUsage?: ((trigger: HTMLButtonElement) => void) | undefined;
  onOpenApps?: (() => void) | undefined;
  onWidthChange: (width: number) => void;
  skillSelectionRequest?: { skillId: string } | null | undefined;
  instructionsFile?: AgentInstructionsCalls | undefined;
  instructionsRequest?: { agentId: string } | null | undefined;
  settingReveal?: AgentSettingReveal | null | undefined;
  onSettingRevealHandled?: ((nonce: number) => void) | undefined;
  routineSelectionRequest?: RoutineSelectionRequest | null | undefined;
  onRoutineSelectionRequestHandled?: ((nonce: number) => void) | undefined;
  onOpenRoutineRun?: ((messageId: string, routineId?: string) => void) | undefined;
  onOpenRoutineThread?: ((routineId: string) => Promise<boolean>) | undefined;
  skillsMode?: AgentSkillsMode | undefined;
  skillsServerId?: string | undefined;
  skillsMarketplaceOpen?: boolean | undefined;
  workspaceCovered?: boolean | undefined;
  tablesVisible?: boolean | undefined;
  agents?: readonly AgentProfile[] | undefined;
  eventRoutines?: EventRoutinesApi | undefined;
  routines?: AgentRoutinesApi | undefined;
  routineRunPlace?: boolean | undefined;
  routinesOnce?: boolean | undefined;
  routineRunCommand?: ((input: TestRoutineInput) => Promise<string>) | undefined;
  routineResultsServerId?: string | RoutineResultsCalls | undefined;
  memoriesApi?: AgentMemoriesApi | undefined;
  onCreateSkill?: (() => void) | undefined;
  onTrySkill?: ((skill: SkillDetail) => void) | undefined;
  previewWorkspaceFile?: ((path: string) => Promise<FilePreview>) | undefined;
  onAddFromMarketplace?: ((agentId: string) => void) | undefined;
  files?: AgentFilesOptions | undefined;
  browserProfileCalls?: BrowserProfileCalls | undefined;
  onManageBrowserProfiles?: ((trigger: HTMLElement) => void) | undefined;
  notificationLevelCalls?: AgentNotificationLevelCalls | undefined;
  serverNotificationLevel?: ServerNotificationLevel | undefined;
  onOpenNotificationSettings?: ((trigger: HTMLElement) => void) | undefined;
}

export type { AgentSkillsMode };

function profilesWithProxies(
  state: {
    profiles: readonly BrowserProfileSummary[] | undefined;
    proxies: readonly BrowserProxySummary[] | undefined;
    computers: readonly BrowserProxyComputer[] | undefined;
  },
  t: ReturnType<typeof useText>["t"],
): BrowserProfileSelectProfile[] | undefined {
  const names = browserProfileProxyNames(state.proxies ?? [], state.computers ?? [], t);
  return state.profiles?.map((profile) => ({ ...profile, proxy: names.get(profile.id) }));
}

export default function AgentSettingsPanel(props: AgentSettingsPanelProps) {
  const { t, errorMessage } = useText();
  const sessionSettings = createMemo((): AgentSessionSettingsApi | undefined => {
    if (!props.sessionSettingsEditable) return undefined;
    if (props.remoteClient) return props.adminCalls?.sessionSettings;
    const serverId = props.skillsServerId;
    const api = conversationPort().agent;
    return {
      read: (agentId) => api.readAgentSessionSettings(agentId, serverId),
      set: (input) => api.setAgentSessionSetting(input, serverId),
      reset: (input) => api.resetAgentSessionSetting(input, serverId),
      subscribe: (agentId, listener) =>
        api.onScopedEvent((scoped) => {
          if (
            scoped.serverId === serverId &&
            scoped.event.type === "agent-session-settings-changed" &&
            scoped.event.agentId === agentId
          )
            listener();
        }),
    };
  });
  const [panelWidth, setPanelWidth] = createSidePanelWidth();
  const [draft, setDraft] = createStore({
    tables: { count: 0, open: false },
    memories: { count: 0, open: false },
    routines: { count: 0, open: false },
    files: { open: false },
    instructions: { open: false },
    skills: { count: 0, open: false, reopenAfterMarketplace: false },
  });
  const browserProfiles = createMemo(() => {
    const calls = props.browserProfileCalls;
    return calls ? createBrowserProfilesStore(() => calls) : undefined;
  });
  const [hostChoice, setHostChoice] = createSignal<AgentBrowserProfile | undefined>(undefined);
  let choiceRequest = 0;
  createEffect(
    () => ({
      store: props.workspaceCovered === true ? undefined : browserProfiles(),
      calls: props.browserProfileCalls,
      agentId: props.agent.id,
      local: props.localHost === true,
    }),
    ({ store, calls, agentId, local }) => {
      ++choiceRequest;
      setHostChoice(undefined);
      if (!store || !calls) return;
      const failed = (error: unknown) => actionToast.error(errorMessage(error, t("browser.profiles.loadFailed")));
      const readChoice = (report: (error: unknown) => void) => {
        const request = ++choiceRequest;
        calls
          .readAgent(agentId)
          .then((choice) => {
            if (request === choiceRequest) setHostChoice(choice);
          })
          .catch(report);
      };
      store.refresh().catch(failed);
      if (local) return store.follow();
      readChoice(failed);
      return store.follow(() => readChoice(() => undefined));
    },
  );
  const browserProfileOptions = (): AgentBrowserProfileOptions | undefined => {
    const store = browserProfiles();
    const manage = props.onManageBrowserProfiles;
    const current = hostChoice();
    if (!store || !manage || (!props.localHost && !current)) return undefined;
    return {
      profiles: profilesWithProxies(store.state, t),
      current,
      onChange: async (agentId, profile) => {
        const saved = await store.assign(agentId, profile);
        if (!props.localHost && agentId === props.agent.id) setHostChoice(saved);
      },
      onCreate: store.create,
      onManage: manage,
    };
  };
  const memoriesPort = createMemo(() =>
    agentMemoriesPort(props.agent.id, props.agent.name, props.memoryLimit ?? null, props.memoriesApi),
  );
  const memoriesShown = () => !props.remoteClient || props.memoriesApi !== undefined;
  const routinesShown = () => !props.remoteClient || props.routines !== undefined;
  const legacyRoutinesPort = createMemo(() =>
    agentRoutinesPort(
      props.agent.id,
      (
        props.localHost === true
          ? agentAutomationAllowed(props.agent, props.agentDefaults ?? DEFAULT_AGENT_DEFAULTS)
          : props.agent.allowAutomation === true
      )
        ? props.routineRunCommand
        : undefined,
      props.localHost === true,
      props.routines,
      props.localHost === true || props.routineRunPlace === true,
      props.routineResultsServerId,
      props.localHost === true || props.routinesOnce === true,
    ),
  );
  const routinesPort = createMemo(() => {
    const eventApi = props.eventRoutines ?? props.adminCalls?.eventRoutines;
    return eventApi
      ? eventRoutinesPort({ kind: "agent", id: props.agent.id }, eventApi, legacyRoutinesPort())
      : legacyRoutinesPort();
  });
  const skillsMode = () => props.skillsMode ?? "mutable";
  const skillCatalog = () => (props.remoteClient ? (props.skillCatalog ?? null) : undefined);
  const tableCalls = (): SharedTableCalls => props.adminCalls?.sharedTables ?? conversationPort().agent;
  const skillCalls = () =>
    props.adminCalls?.skills ?? agentSkillCalls(skillsMode() === "host" ? props.skillsServerId : undefined);
  const storage = createStorageUsage(
    () => {
      const files = props.files;
      return files ? { serverId: files.serverId, input: { scope: "agent", agentId: props.agent.id } } : null;
    },
    () => props.files?.calls ?? filesPort(),
  );
  let lastSkillsMarketplaceOpen = untrack(() => props.skillsMarketplaceOpen === true);
  createEffect(
    () => panelWidth(),
    (width) => {
      props.onWidthChange(width);
    },
  );

  const currentAgentId = createMemo(() => props.agent.id);

  const [ownLevels, setOwnLevels] = createSignal<ReadonlyMap<string, ServerNotificationLevel> | undefined>(undefined);
  let levelsRequest = 0;
  let levelsCalls: AgentNotificationLevelCalls | undefined;
  createEffect(
    () => ({ calls: props.notificationLevelCalls, agentId: currentAgentId() }),
    ({ calls }) => {
      const request = ++levelsRequest;
      if (calls !== levelsCalls) {
        levelsCalls = calls;
        setOwnLevels(undefined);
      }
      if (!calls) return;
      calls.list().then(
        (snapshot) => {
          if (request === levelsRequest) setOwnLevels(agentNotificationLevelMap(snapshot));
        },
        () => undefined,
      );
    },
  );
  createEffect(
    () => props.notificationLevelCalls,
    (calls) => {
      if (!calls?.subscribe) return;
      return calls.subscribe((snapshot) => {
        if (calls === levelsCalls) {
          ++levelsRequest;
          setOwnLevels(agentNotificationLevelMap(snapshot));
        }
      });
    },
  );
  const notificationLevelOptions = (): AgentNotificationLevelOptions | undefined => {
    const open = props.onOpenNotificationSettings;
    const levels = ownLevels();
    if (!open || !levels) return undefined;
    return {
      current: levels.get(props.agent.id) ?? null,
      serverLevel: props.serverNotificationLevel ?? "all",
      onOpen: open,
    };
  };
  createEffect(
    () => ({
      agentId: currentAgentId(),
      remoteClient: untrack(() => props.remoteClient === true),
      tablesVisible: untrack(() => props.tablesVisible !== false),
      memories: untrack(memoriesShown),
      routines: untrack(routinesShown),
    }),
    ({ agentId, remoteClient, tablesVisible, memories, routines }) => {
      setDraft((state) => {
        state.tables.open = false;
        state.memories.open = false;
        state.routines.open = false;
        state.files.open = false;
        state.instructions.open = false;
        state.skills.open = false;
        state.skills.reopenAfterMarketplace = false;
      });
      if (!remoteClient || tablesVisible) {
        void tableCalls()
          .listTables()
          .catch(() => [])
          .then((items) => {
            setDraft((state) => {
              state.tables.count = items.length;
            });
          });
      }
      void untrack(() => loadSkillsCount(agentId));
      if (memories) untrack(() => loadMemoriesCount(memoriesPort()));
      if (routines) untrack(() => loadRoutinesCount(routinesPort()));
    },
  );

  createEffect(
    () => ({
      memories: memoriesShown() ? memoriesPort() : null,
      routines: routinesShown() ? routinesPort() : null,
    }),
    ({ memories, routines }) => {
      const stopMemories = memories?.subscribe(() => loadMemoriesCount(memories));
      const stopRoutines = routines?.subscribe(() => loadRoutinesCount(routines));
      return () => {
        stopMemories?.();
        stopRoutines?.();
      };
    },
  );

  function loadMemoriesCount(port: MemoriesPort): void {
    void port
      .list()
      .catch(() => [])
      .then((items) => {
        setDraft((state) => {
          state.memories.count = items.length;
        });
      });
  }

  function loadRoutinesCount(port: RoutinesPort): void {
    void port
      .list()
      .catch(() => [])
      .then((items) => {
        setDraft((state) => {
          state.routines.count = items.length;
        });
      });
  }

  createEffect(
    () => [props.agent.id, skillsMode(), skillCalls()] as const,
    ([agentId, mode, calls]) => {
      if (mode === "hidden" || !calls.onChanged) return;
      return calls.onChanged((changedId) => {
        if (changedId === agentId) void loadSkillsCount(agentId);
      });
    },
  );

  async function loadSkillsCount(agentId: string): Promise<void> {
    if (skillsMode() === "hidden") {
      setDraft((state) => {
        state.skills.count = 0;
      });
      return;
    }
    try {
      const items =
        skillsMode() === "readonly"
          ? await skillsPort().agent.listInstalledSkills(agentId)
          : await skillCalls().listInstalled(agentId);
      setDraft((state) => {
        state.skills.count = userAssignedSkills(items).length;
      });
    } catch {
      setDraft((state) => {
        state.skills.count = 0;
      });
    }
  }

  createEffect(
    () => ({
      open: props.skillsMarketplaceOpen === true,
      covered: untrack(() => props.workspaceCovered === true),
    }),
    ({ open, covered }) => {
      if (lastSkillsMarketplaceOpen && !open && untrack(() => draft.skills.reopenAfterMarketplace)) {
        setDraft((state) => {
          state.skills.reopenAfterMarketplace = false;
          state.skills.open = !covered;
        });
      }
      lastSkillsMarketplaceOpen = open;
    },
  );

  createEffect(
    () => ({ request: props.routineSelectionRequest, agentId: props.agent.id }),
    ({ request }) => {
      if (request) {
        setDraft((state) => {
          state.routines.open = true;
        });
      }
    },
  );

  const skillSelectionRequest = createMemo(() => props.skillSelectionRequest);
  createEffect(skillSelectionRequest, (request) => {
    if (request)
      setDraft((state) => {
        state.skills.open = true;
      });
  });

  const instructionsRequest = createMemo(() => props.instructionsRequest);
  createEffect(instructionsRequest, (request) => {
    if (request)
      setDraft((state) => {
        state.instructions.open = true;
      });
  });

  const settingReveal = createMemo(() => props.settingReveal);
  const [panelReveal, setPanelReveal] = createSignal<AgentSettingReveal | null>(null);
  let detailLeaveGuard: DetailLeaveGuard | null = null;
  createEffect(settingReveal, (request) => {
    if (!request) return;
    props.onSettingRevealHandled?.(request.nonce);
    const guard = detailLeaveGuard;
    untrack(() => (guard ? guard(() => revealSetting(request)) : revealSetting(request)));
  });
  function revealSetting(request: AgentSettingReveal): void {
    const detail = revealDetail(request.settingId);
    setDraft((state) => {
      state.instructions.open = detail === "instructions";
      state.memories.open = detail === "memories";
      state.skills.open = detail === "skills";
      state.routines.open = detail === "routines";
      state.files.open = false;
    });
    setPanelReveal(detail === "skills" ? null : request);
  }
  function revealDetail(settingId: AgentSettingLinkId): "instructions" | "memories" | "skills" | "routines" | null {
    if (settingId === "agent.instructions" && props.instructionsFile) return "instructions";
    if (settingId === "agent.memories" && memoriesShown()) return "memories";
    if (settingId === "agent.skills" && skillsMode() !== "hidden") return "skills";
    if (settingId === "agent.routines" && routinesShown()) return "routines";
    return null;
  }

  return (
    <SharedAgentSettingsPanel
      {...props}
      reveal={panelReveal()}
      browserProfiles={browserProfileOptions()}
      notificationLevel={notificationLevelOptions()}
      width={panelWidth()}
      onResize={setPanelWidth}
      onResizeEnd={saveSidePanelWidth}
      preferredWidth={readSidePanelWidth}
      onUnshownSaveError={(message) =>
        actionToast.error(message, {
          id: "agent-settings-save-failed",
          report: { operation: "settings", source: "action", cause_code: "unknown" },
        })
      }
      detailOpen={draft.routines.open || draft.files.open || draft.memories.open || draft.instructions.open}
      links={
        <>
          <Show when={sessionSettings()}>
            {(api) => (
              <AgentSessionSettings
                agentId={props.agent.id}
                providerIdentity={`${props.runtimeSettings.provider}:${props.runtimeSettings.model}`}
                api={api()}
              />
            )}
          </Show>
          <Show
            when={
              memoriesShown() ||
              skillsMode() !== "hidden" ||
              props.tablesVisible !== false ||
              props.files ||
              props.instructionsFile
            }
          >
            <SettingsLinkGroup inset title={t("agentSettings.groups.knows")}>
              <Show when={props.instructionsFile}>
                <SettingsLinkRow
                  icon={<FileText aria-hidden="true" />}
                  label={t("agentSettings.instructions")}
                  onClick={() =>
                    setDraft((state) => {
                      state.instructions.open = true;
                    })
                  }
                />
              </Show>
              <Show when={memoriesShown()}>
                <SettingsLinkRow
                  icon={<BookMarked aria-hidden="true" />}
                  label={t("agentSettings.links.memories")}
                  value={t("agentSettings.links.memoriesCount", { count: draft.memories.count })}
                  onClick={() =>
                    setDraft((state) => {
                      state.memories.open = true;
                    })
                  }
                />
              </Show>
              <Show when={skillsMode() !== "hidden"}>
                <SettingsLinkRow
                  icon={<Puzzle aria-hidden="true" />}
                  label={t("agentSettings.links.skills")}
                  value={t("agentSettings.links.skillsCount", { count: draft.skills.count })}
                  onClick={() =>
                    setDraft((state) => {
                      state.skills.open = true;
                    })
                  }
                />
              </Show>
              <Show when={props.files}>
                <SettingsLinkRow
                  icon={<Folder aria-hidden="true" />}
                  label={t("agentSettings.links.files")}
                  value={storage.state.usage ? agentFilesLinkValue(storage.state.usage.breakdown) : undefined}
                  onClick={() =>
                    setDraft((state) => {
                      state.files.open = true;
                    })
                  }
                />
              </Show>
              <Show when={props.tablesVisible !== false}>
                <SettingsLinkRow
                  icon={<Table2 aria-hidden="true" />}
                  label={t("agentSettings.links.tables")}
                  value={t("agentSettings.links.tablesCount", { count: draft.tables.count })}
                  onClick={() =>
                    setDraft((state) => {
                      state.tables.open = true;
                    })
                  }
                />
              </Show>
            </SettingsLinkGroup>
          </Show>
          <Show when={routinesShown() || props.onOpenUsage || props.onOpenApps || props.onPublish}>
            <SettingsLinkGroup inset title={t("agentSettings.groups.does")}>
              <Show when={routinesShown()}>
                <SettingsLinkRow
                  icon={<CalendarClock aria-hidden="true" />}
                  label={t("agentSettings.links.routines")}
                  value={t("agentSettings.links.routinesCount", { count: draft.routines.count })}
                  onClick={() =>
                    setDraft((state) => {
                      state.routines.open = true;
                    })
                  }
                />
              </Show>
              <Show when={props.onOpenUsage}>
                <SettingsLinkRow
                  icon={<Gauge aria-hidden="true" />}
                  label={t("agentSettings.links.usage")}
                  onClick={(trigger) => props.onOpenUsage?.(trigger)}
                />
              </Show>
              <Show when={props.onOpenApps}>
                <SettingsLinkRow
                  icon={<Blocks aria-hidden="true" />}
                  label={t("agentSettings.links.apps")}
                  value={t("agentSettings.links.appsScope")}
                  onClick={() => props.onOpenApps?.()}
                />
              </Show>
              <Show when={props.onPublish}>
                <SettingsLinkRow
                  icon={<Upload aria-hidden="true" />}
                  label={t("conversation.header.publish")}
                  onClick={() => props.onPublish?.()}
                />
              </Show>
            </SettingsLinkGroup>
          </Show>
        </>
      }
    >
      <Show when={draft.instructions.open && props.instructionsFile}>
        {(calls) => (
          <AgentInstructionsView
            agentId={props.agent.id}
            folder={props.agent.workspacePath}
            working={props.working}
            calls={calls()}
            onBack={() =>
              setDraft((state) => {
                state.instructions.open = false;
              })
            }
            onClose={props.onClose}
          />
        )}
      </Show>
      <Show when={draft.files.open && props.files}>
        {(files) => (
          <AgentFilesSettings
            {...files()}
            agentName={props.agent.name}
            storage={storage}
            onBack={() =>
              setDraft((state) => {
                state.files.open = false;
              })
            }
            onClose={props.onClose}
          />
        )}
      </Show>
      <Show when={draft.routines.open}>
        <div class="agent-routines-overlay">
          <AgentRoutinesSettings
            port={routinesPort()}
            onCountChange={(count) =>
              setDraft((state) => {
                state.routines.count = count;
              })
            }
            onBack={() =>
              setDraft((state) => {
                state.routines.open = false;
              })
            }
            onClose={props.onClose}
            registerLeaveGuard={(guard) => {
              detailLeaveGuard = guard;
            }}
            selectionRequest={props.routineSelectionRequest}
            onSelectionRequestHandled={props.onRoutineSelectionRequestHandled}
            onOpenRun={props.onOpenRoutineRun}
            onOpenThread={props.onOpenRoutineThread}
            agentName={props.agent.name}
          />
        </div>
      </Show>
      <Show when={props.tablesVisible !== false}>
        <SharedTablesModal
          agents={props.agents ?? []}
          calls={props.adminCalls?.sharedTables}
          open={draft.tables.open}
          onOpenChange={(open) =>
            setDraft((state) => {
              state.tables.open = open;
            })
          }
          onCountChange={(count) =>
            setDraft((state) => {
              state.tables.count = count;
            })
          }
        />
      </Show>
      <AgentMemoriesSettings
        port={memoriesPort()}
        open={draft.memories.open}
        onBack={() =>
          setDraft((state) => {
            state.memories.open = false;
          })
        }
        onClose={props.onClose}
        onCountChange={(count) =>
          setDraft((state) => {
            state.memories.count = count;
          })
        }
      />
      <Show when={skillsMode() !== "hidden"}>
        <AgentSkillsModal
          selectionRequest={props.skillSelectionRequest}
          agentId={props.agent.id}
          agentName={props.agent.name}
          open={draft.skills.open}
          skillsMode={skillsMode()}
          serverId={props.skillsServerId}
          calls={props.adminCalls?.skills}
          catalog={skillCatalog()}
          onCreateSkill={props.onCreateSkill}
          onTrySkill={props.onTrySkill}
          previewWorkspaceFile={props.previewWorkspaceFile}
          onAddFromMarketplace={
            props.onAddFromMarketplace
              ? (agentId) => {
                  setDraft((state) => {
                    state.skills.reopenAfterMarketplace = true;
                    state.skills.open = false;
                  });
                  props.onAddFromMarketplace?.(agentId);
                }
              : undefined
          }
          onOpenChange={(open) =>
            setDraft((state) => {
              state.skills.open = open;
            })
          }
          onCountChange={(count) =>
            setDraft((state) => {
              state.skills.count = count;
            })
          }
        />
      </Show>
    </SharedAgentSettingsPanel>
  );
}
