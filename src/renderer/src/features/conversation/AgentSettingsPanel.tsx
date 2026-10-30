import {
  type AgentBrowserProfile,
  agentAutomationAllowed,
  agentNotificationLevelMap,
  assignedSkillCount,
  DEFAULT_AGENT_DEFAULTS,
  type FilePreview,
  type ServerNotificationLevel,
} from "@openbot/contracts/ipc";
import { BookMarked, CalendarClock, Folder, Gauge, Puzzle, Table2, Upload } from "@openbot/ui";
import { SettingsLinkGroup, SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import type { AgentProfile } from "@openbot/ui/data";
import {
  AgentSessionSettings,
  type AgentSessionSettingsApi,
} from "@openbot/ui/features/conversation/AgentSessionSettings";
import SharedAgentSettingsPanel, {
  type AgentBrowserProfileOptions,
  type AgentNotificationLevelOptions,
  type AgentSettingsPanelProps as SharedAgentSettingsPanelProps,
} from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { agentFilesLinkValue } from "@openbot/ui/features/files/AgentFilesView";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { createSettingsPanelWidth, saveSettingsPanelWidth } from "../../components/settings-panel-width";
import { agentSkillCalls, skillsPort } from "../../skills-port";
import type { BrowserProfileCalls } from "../browser/browser-profiles-port";
import { createBrowserProfilesStore } from "../browser/stores/browser-profiles-store";
import { type AgentFilesOptions, AgentFilesSettings } from "../files/AgentFilesSettings";
import { createStorageUsage } from "../files/storage-usage";
import { AgentMemoriesModal } from "./AgentMemoriesModal";
import { AgentRoutinesSettings, type RoutineSelectionRequest } from "./AgentRoutinesSettings";
import { AgentSkillsModal, type AgentSkillsMode, type SkillDetail } from "./AgentSkillsModal";
import { conversationPort, type SharedTableCalls } from "./conversation-port";
import type { AgentNotificationLevelCalls, ConversationRuntime } from "./conversation-runtime";
import { agentMemoriesPort } from "./memories-port";
import type { EventRoutinesApi } from "./routine-webhooks-api";
import { type AgentRoutinesApi, agentRoutinesPort, eventRoutinesPort, type RoutinesPort } from "./routines-port";
import { SharedTablesModal } from "./SharedTablesModal";

interface AgentSettingsPanelProps
  extends Omit<
    SharedAgentSettingsPanelProps,
    "width" | "onResize" | "onResizeEnd" | "links" | "detailOpen" | "children" | "browserProfiles" | "notificationLevel"
  > {
  remoteClient?: boolean;
  /** Routines can copy local run commands only on the computer that runs the agent. */
  localHost?: boolean;
  sessionSettingsEditable?: boolean;
  /** The memory cap of an agent on this computer. Absent for a remote agent: its host enforces its own. */
  memoryLimit?: number | undefined;
  /** The web client's host calls for the settings that its server supports. */
  adminCalls?: ConversationRuntime["admin"] | undefined;
  onPublish?: (() => void) | undefined;
  onOpenUsage?: ((trigger: HTMLButtonElement) => void) | undefined;
  onWidthChange: (width: number) => void;
  skillSelectionRequest?: { skillId: string } | null | undefined;
  routineSelectionRequest?: RoutineSelectionRequest | null | undefined;
  onRoutineSelectionRequestHandled?: ((nonce: number) => void) | undefined;
  onOpenRoutineRun?: ((messageId: string) => void) | undefined;
  skillsMode?: AgentSkillsMode | undefined;
  /** The joined server that runs the agent, for the `host` skills mode. */
  skillsServerId?: string | undefined;
  skillsMarketplaceOpen?: boolean | undefined;
  /** Another page of the window covers the conversation. */
  workspaceCovered?: boolean | undefined;
  /** The shared data lives on the computer that runs the agents. A joined server shows it to an admin only. */
  tablesVisible?: boolean | undefined;
  /** Names the agent that keeps each set of records. Threaded like `customProviders`, for the same reason. */
  agents?: readonly AgentProfile[] | undefined;
  /** Event routine calls for a host that advertises `events-v1`; absent keeps the released schedule API. */
  eventRoutines?: EventRoutinesApi | undefined;
  /** The released schedule API of a client without the desktop port. Absent, preload sends it. */
  routines?: AgentRoutinesApi | undefined;
  onCreateSkill?: (() => void) | undefined;
  onTrySkill?: ((skill: SkillDetail) => void) | undefined;
  /** Reads a file in the agent workspace, on the computer that runs the agent. */
  previewWorkspaceFile?: ((path: string) => Promise<FilePreview>) | undefined;
  onAddFromMarketplace?: ((agentId: string) => void) | undefined;
  /** The Files row. Left out for a remote server without `storage-v1`. */
  files?: AgentFilesOptions | undefined;
  /** The profile calls of the host that runs the agent, for an owner or admin. Absent hides the row. */
  browserProfileCalls?: BrowserProfileCalls | undefined;
  /** Opens the Browser profiles section of the settings of the server that runs the agent. */
  onManageBrowserProfiles?: ((trigger: HTMLElement) => void) | undefined;
  /** The user's own level of each agent on the server. Absent when the server cannot keep it. */
  notificationLevelCalls?: AgentNotificationLevelCalls | undefined;
  /** The level of the server that runs the agent. */
  serverNotificationLevel?: ServerNotificationLevel | undefined;
  /** Opens the notification settings of the server that runs the agent. Absent hides the row. */
  onOpenNotificationSettings?: ((trigger: HTMLElement) => void) | undefined;
}

export type { AgentSkillsMode };

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
  const [panelWidth, setPanelWidth] = createSettingsPanelWidth();
  const [draft, setDraft] = createStore({
    tables: { count: 0, open: false },
    memories: { count: 0, open: false },
    routines: { count: 0, open: false },
    files: { open: false },
    skills: { count: 0, open: false, reopenAfterMarketplace: false },
  });
  // One store per host. It goes with the host, so the list of the last server never shows for the next.
  const browserProfiles = createMemo(() => {
    const calls = props.browserProfileCalls;
    return calls ? createBrowserProfilesStore(() => calls) : undefined;
  });
  // The summary of an agent on a joined server does not carry its profile, so the panel reads it
  // from the host. Undefined until it arrives, and for an agent on this computer.
  const [hostChoice, setHostChoice] = createSignal<AgentBrowserProfile | undefined>(undefined);
  let choiceRequest = 0;
  // The settings page covers the conversation while it changes the profiles, so the list loads again
  // each time the conversation shows.
  createEffect(
    () => ({
      store: props.workspaceCovered === true ? undefined : browserProfiles(),
      calls: props.browserProfileCalls,
      agentId: props.agent.id,
      local: props.localHost === true,
    }),
    ({ store, calls, agentId, local }) => {
      const request = ++choiceRequest;
      setHostChoice(undefined);
      if (!store || !calls) return;
      const failed = (error: unknown) => actionToast.error(errorMessage(error, t("browser.profiles.loadFailed")));
      store.refresh().catch(failed);
      if (local) return;
      calls
        .readAgent(agentId)
        .then((choice) => {
          if (request === choiceRequest) setHostChoice(choice);
        })
        .catch(failed);
    },
  );
  const browserProfileOptions = (): AgentBrowserProfileOptions | undefined => {
    const store = browserProfiles();
    const manage = props.onManageBrowserProfiles;
    const current = hostChoice();
    if (!store || !manage || (!props.localHost && !current)) return undefined;
    return {
      profiles: store.state.profiles,
      current,
      onChange: async (agentId, profile) => {
        const saved = await store.assign(agentId, profile);
        if (!props.localHost && agentId === props.agent.id) setHostChoice(saved);
      },
      onCreate: store.create,
      onManage: manage,
    };
  };
  const memoriesPort = createMemo(() => agentMemoriesPort(props.agent.id, props.agent.name, props.memoryLimit ?? null));
  const legacyRoutinesPort = createMemo(() =>
    agentRoutinesPort(
      props.agent.id,
      props.localHost === true && agentAutomationAllowed(props.agent, props.agentDefaults ?? DEFAULT_AGENT_DEFAULTS),
      // Set only for the host on this computer, the one place the policy is kept.
      props.localHost === true,
      props.routines,
    ),
  );
  const routinesPort = createMemo(() => {
    const eventApi = props.eventRoutines ?? props.adminCalls?.eventRoutines;
    return eventApi
      ? eventRoutinesPort({ kind: "agent", id: props.agent.id }, eventApi, legacyRoutinesPort())
      : legacyRoutinesPort();
  });
  const skillsMode = () => props.skillsMode ?? "mutable";
  const tableCalls = (): SharedTableCalls => props.adminCalls?.sharedTables ?? conversationPort().agent;
  const skillCalls = () =>
    props.adminCalls?.skills ?? agentSkillCalls(skillsMode() === "host" ? props.skillsServerId : undefined);
  const storage = createStorageUsage(() => {
    const files = props.files;
    return files ? { serverId: files.serverId, input: { scope: "agent", agentId: props.agent.id } } : null;
  });
  let lastSkillsMarketplaceOpen = untrack(() => props.skillsMarketplaceOpen === true);
  createEffect(
    () => panelWidth(),
    (width) => {
      props.onWidthChange(width);
    },
  );

  // An effect runs again for an equal value, and each activity of the agent gives a new agent
  // object. The memo keeps an open view, such as a routine edit, until the agent changes.
  const currentAgentId = createMemo(() => props.agent.id);

  // The user's own level of each agent. Undefined while it loads, and when the read fails: the row
  // then stays hidden. Another device can change it, so it loads again for each agent.
  const [ownLevels, setOwnLevels] = createSignal<ReadonlyMap<string, ServerNotificationLevel> | undefined>(undefined);
  let levelsRequest = 0;
  let levelsCalls: AgentNotificationLevelCalls | undefined;
  createEffect(
    () => ({ calls: props.notificationLevelCalls, agentId: currentAgentId() }),
    ({ calls }) => {
      const request = ++levelsRequest;
      // The levels of the last server must not show for the next one.
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
  // A change on another device of the user shows at once.
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
      // Read here, not in the callback: a prop can be a compiled memo, and the callback has no owner.
      remoteClient: untrack(() => props.remoteClient === true),
      tablesVisible: untrack(() => props.tablesVisible !== false),
    }),
    ({ agentId, remoteClient, tablesVisible }) => {
      setDraft((state) => {
        state.tables.open = false;
        state.memories.open = false;
        state.routines.open = false;
        state.files.open = false;
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
      if (!remoteClient) {
        loadMemoriesCount(agentId);
        untrack(() => loadRoutinesCount(routinesPort()));
      }
    },
  );

  // The counts follow a memory or routine change, also one that the agent makes in a turn.
  createEffect(
    () => (props.remoteClient ? null : ([currentAgentId(), memoriesPort(), routinesPort()] as const)),
    (sources) => {
      if (!sources) return;
      const [agentId, memories, routines] = sources;
      const stopMemories = memories.subscribe(() => loadMemoriesCount(agentId));
      const stopRoutines = routines.subscribe(() => loadRoutinesCount(routines));
      return () => {
        stopMemories();
        stopRoutines();
      };
    },
  );

  function loadMemoriesCount(agentId: string): void {
    void conversationPort()
      .agent.listMemories(agentId)
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

  // The count follows a skill change made anywhere, as the dialog does.
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
        state.skills.count = assignedSkillCount(items);
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
      // Read here, not in the callback: the prop can be a compiled memo, and the callback has no owner.
      covered: untrack(() => props.workspaceCovered === true),
    }),
    ({ open, covered }) => {
      if (lastSkillsMarketplaceOpen && !open && untrack(() => draft.skills.reopenAfterMarketplace)) {
        // The Marketplace page can close for another page. The skills dialog then stays closed.
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

  // The request stays set after the dialog closes, and it is read again at each activity of the agent.
  // The memo opens the dialog again only for a new request.
  const skillSelectionRequest = createMemo(() => props.skillSelectionRequest);
  createEffect(skillSelectionRequest, (request) => {
    if (request)
      setDraft((state) => {
        state.skills.open = true;
      });
  });

  return (
    <SharedAgentSettingsPanel
      {...props}
      browserProfiles={browserProfileOptions()}
      notificationLevel={notificationLevelOptions()}
      width={panelWidth()}
      onResize={setPanelWidth}
      onResizeEnd={saveSettingsPanelWidth}
      detailOpen={draft.routines.open || draft.files.open}
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
          <Show when={!props.remoteClient || skillsMode() !== "hidden" || props.tablesVisible !== false || props.files}>
            <SettingsLinkGroup inset title={t("agentSettings.groups.knows")}>
              <Show when={!props.remoteClient}>
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
          <Show when={!props.remoteClient || props.onPublish}>
            <SettingsLinkGroup inset title={t("agentSettings.groups.does")}>
              <Show when={!props.remoteClient}>
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
              <Show when={!props.remoteClient && props.onOpenUsage}>
                <SettingsLinkRow
                  icon={<Gauge aria-hidden="true" />}
                  label={t("agentSettings.links.usage")}
                  onClick={(trigger) => props.onOpenUsage?.(trigger)}
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
            selectionRequest={props.routineSelectionRequest}
            onSelectionRequestHandled={props.onRoutineSelectionRequestHandled}
            onOpenRun={props.onOpenRoutineRun}
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
      <AgentMemoriesModal
        port={memoriesPort()}
        open={draft.memories.open}
        onOpenChange={(open) =>
          setDraft((state) => {
            state.memories.open = open;
          })
        }
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
          catalog={props.remoteClient ? null : undefined}
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
