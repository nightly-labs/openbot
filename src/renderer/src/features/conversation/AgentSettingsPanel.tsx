import type { MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { SettingsLinkGroup, SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import type { AgentProfile } from "@openbot/ui/data";
import SharedAgentSettingsPanel, {
  type AgentSettingsPanelProps as SharedAgentSettingsPanelProps,
} from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { agentFilesLinkValue } from "@openbot/ui/features/files/AgentFilesView";
import { createEffect, createMemo, createStore, Show } from "solid-js";
import { createSettingsPanelWidth, saveSettingsPanelWidth } from "../../components/settings-panel-width";
import { agentSkillCalls, skillsPort } from "../../skills-port";
import { type AgentFilesOptions, AgentFilesSettings } from "../files/AgentFilesSettings";
import { createStorageUsage } from "../files/storage-usage";
import { AgentMemoriesModal } from "./AgentMemoriesModal";
import { AgentRoutinesSettings, type RoutineSelectionRequest } from "./AgentRoutinesSettings";
import { AgentSkillsModal, type AgentSkillsMode, assignedSkillCount } from "./AgentSkillsModal";
import { conversationPort } from "./conversation-port";
import { agentMemoriesPort } from "./memories-port";
import { agentRoutinesPort } from "./routines-port";
import { SharedTablesModal } from "./SharedTablesModal";

interface AgentSettingsPanelProps
  extends Omit<
    SharedAgentSettingsPanelProps,
    "width" | "onResize" | "onResizeEnd" | "links" | "detailOpen" | "children"
  > {
  remoteClient?: boolean;
  onOpenUsage?: (trigger: HTMLButtonElement) => void;
  onWidthChange: (width: number) => void;
  skillSelectionRequest?: { skillId: string } | null;
  routineSelectionRequest?: RoutineSelectionRequest | null;
  onRoutineSelectionRequestHandled?: (nonce: number) => void;
  onOpenRoutineRun?: (messageId: string) => void;
  skillsMode?: AgentSkillsMode;
  /** The joined server that runs the agent, for the `host` skills mode. */
  skillsServerId?: string;
  skillsMarketplaceOpen?: boolean;
  /** The shared data lives on the computer that runs the agents. A joined server shows it to an admin only. */
  tablesVisible?: boolean;
  /** Names the agent that keeps each set of records. Threaded like `customProviders`, for the same reason. */
  agents?: readonly AgentProfile[];
  onCreateSkill?: () => void;
  onTrySkill?: (skill: MarketplaceSkillDetail) => void;
  onAddFromMarketplace?: (agentId: string) => void;
  /** The Files row. Left out for a remote server without `storage-v1`. */
  files?: AgentFilesOptions;
}

export type { AgentSkillsMode };

export default function AgentSettingsPanel(props: AgentSettingsPanelProps) {
  const [panelWidth, setPanelWidth] = createSettingsPanelWidth();
  const [draft, setDraft] = createStore({
    tables: { count: 0, open: false },
    memories: { count: 0, open: false },
    routines: { count: 0, open: false },
    files: { open: false },
    skills: { count: 0, open: false, reopenAfterMarketplace: false },
  });
  const memoriesPort = createMemo(() => agentMemoriesPort(props.agent.id, props.agent.name));
  const routinesPort = createMemo(() => agentRoutinesPort(props.agent.id));
  const skillsMode = () => props.skillsMode ?? "mutable";
  const storage = createStorageUsage(() => {
    const files = props.files;
    return files ? { serverId: files.serverId, input: { scope: "agent", agentId: props.agent.id } } : null;
  });
  let lastSkillsMarketplaceOpen = props.skillsMarketplaceOpen === true;
  createEffect(
    () => panelWidth(),
    (width) => {
      props.onWidthChange(width);
    },
  );

  createEffect(
    () => props.agent.id,
    (agentId) => {
      setDraft((state) => {
        state.tables.open = false;
        state.memories.open = false;
        state.routines.open = false;
        state.files.open = false;
        state.skills.open = false;
        state.skills.reopenAfterMarketplace = false;
      });
      if (!props.remoteClient) {
        void conversationPort()
          .agent.listTables()
          .catch(() => [])
          .then((items) => {
            setDraft((state) => {
              state.tables.count = items.length;
            });
          });
        void conversationPort()
          .agent.listMemories(agentId)
          .catch(() => [])
          .then((items) => {
            setDraft((state) => {
              state.memories.count = items.length;
            });
          });
        void conversationPort()
          .agent.listRoutines(agentId)
          .catch(() => [])
          .then((items) => {
            setDraft((state) => {
              state.routines.count = items.length;
            });
          });
        void loadSkillsCount(agentId);
      }
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
          : await agentSkillCalls(skillsMode() === "host" ? props.skillsServerId : undefined).listInstalled(agentId);
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
    () => props.skillsMarketplaceOpen === true,
    (open) => {
      if (lastSkillsMarketplaceOpen && !open && draft.skills.reopenAfterMarketplace) {
        setDraft((state) => {
          state.skills.reopenAfterMarketplace = false;
          state.skills.open = true;
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

  createEffect(
    () => props.skillSelectionRequest,
    (request) => {
      if (request)
        setDraft((state) => {
          state.skills.open = true;
        });
    },
  );

  return (
    <SharedAgentSettingsPanel
      {...props}
      width={panelWidth()}
      onResize={setPanelWidth}
      onResizeEnd={saveSettingsPanelWidth}
      detailOpen={draft.routines.open || draft.files.open}
      links={
        <Show when={!props.remoteClient}>
          <SettingsLinkGroup>
            <Show when={props.onOpenUsage}>
              <SettingsLinkRow label="Usage" onClick={(trigger) => props.onOpenUsage?.(trigger)} />
            </Show>
            <SettingsLinkRow
              label="Memories"
              value={`${draft.memories.count} saved`}
              onClick={() =>
                setDraft((state) => {
                  state.memories.open = true;
                })
              }
            />
            <Show when={skillsMode() !== "hidden"}>
              <SettingsLinkRow
                label="Skills"
                value={`${draft.skills.count} assigned`}
                onClick={() =>
                  setDraft((state) => {
                    state.skills.open = true;
                  })
                }
              />
            </Show>
            <Show when={props.tablesVisible !== false}>
              <SettingsLinkRow
                label="Tables"
                value={`${draft.tables.count} ${draft.tables.count === 1 ? "table" : "tables"}`}
                onClick={() =>
                  setDraft((state) => {
                    state.tables.open = true;
                  })
                }
              />
            </Show>
            <Show when={props.files}>
              <SettingsLinkRow
                label="Files"
                value={storage.state.usage ? agentFilesLinkValue(storage.state.usage.breakdown) : undefined}
                onClick={() =>
                  setDraft((state) => {
                    state.files.open = true;
                  })
                }
              />
            </Show>
            <SettingsLinkRow
              label="Routines"
              value={`${draft.routines.count} configured`}
              onClick={() =>
                setDraft((state) => {
                  state.routines.open = true;
                })
              }
            />
          </SettingsLinkGroup>
        </Show>
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
          onCreateSkill={props.onCreateSkill}
          onTrySkill={props.onTrySkill}
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
