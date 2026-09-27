import {
  ACP_AGENT_PRESETS,
  type CheckCustomAgentInput,
  type CustomAgentCheckResult,
  type CustomAgentSummary,
  type CustomProviderRestart,
  type SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  ConfirmDialog,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Pencil,
  Plus,
  SettingsSection,
  Text,
  Trash2,
} from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { CustomAcpAgentDialog } from "./CustomAcpAgentDialog";
import {
  type AcpAgentCheck,
  type CustomAcpAgentDraft,
  customAgentCheckInput,
  customAgentInput,
  emptyCustomAcpAgentDraft,
  savedAcpAgentDraft,
} from "./custom-acp-agent-form";

/** What the host does with the user's own ACP agents. This computer only: each is a command here. */
export interface CustomAgentSettingsApi {
  agents: readonly CustomAgentSummary[];
  /** Rejects with the reason, so the form stays open with what the user typed. */
  save: (input: SaveCustomAgentInput) => Promise<CustomProviderRestart>;
  remove: (id: string) => Promise<CustomProviderRestart>;
  /** One trial start. Rejects with the reason the agent did not answer. */
  check: (input: CheckCustomAgentInput) => Promise<CustomAgentCheckResult>;
}

/**
 * The custom agents run in one process group that OpenBot restarts after a change, but not through a
 * turn in progress. The write is durable either way, so none of these is an error.
 */
const RESTART_NOTE = {
  saved: {
    restarted: "customProvider.agents.saved.restarted",
    "skipped-busy": "customProvider.agents.saved.skippedBusy",
    "not-running": "customProvider.agents.saved.notRunning",
  },
  removed: {
    restarted: "customProvider.agents.removed.restarted",
    "skipped-busy": "customProvider.agents.removed.skippedBusy",
    "not-running": "customProvider.agents.removed.notRunning",
  },
} as const satisfies Record<"saved" | "removed", Record<CustomProviderRestart, AppTextKey>>;

/** The note after an agent is saved or removed: when the agent list catches up. */
export function customAgentRestartKey(action: "saved" | "removed", restart: CustomProviderRestart): AppTextKey {
  return RESTART_NOTE[action][restart];
}

/** The form of one agent: a new one, or a saved one that keeps its ID. */
type AgentForm = { draft: CustomAcpAgentDraft; saved?: CustomAgentSummary };

export function checkResult(result: CustomAgentCheckResult): AcpAgentCheck {
  return {
    status: "ok",
    agentName: result.agentName,
    ...(result.version === null ? {} : { version: result.version }),
    protocolVersion: result.protocolVersion,
    capabilities: result.capabilities,
  };
}

/** The user's own ACP agents in Settings: the list, and the form that adds or changes one. */
export function CustomAgentSettings(props: { api: CustomAgentSettingsApi }) {
  const { t, errorMessage } = useText();
  const [form, setForm] = createSignal<AgentForm | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string | null>(null);
  const [check, setCheck] = createSignal<AcpAgentCheck>({ status: "idle" });
  const [note, setNote] = createSignal<string | null>(null);
  const [removing, setRemoving] = createSignal<string | null>(null);
  const [confirming, setConfirming] = createSignal<CustomAgentSummary | null>(null);

  function open(next: AgentForm): void {
    setSubmitError(null);
    setCheck({ status: "idle" });
    setNote(null);
    setForm(next);
  }

  async function submit(draft: CustomAcpAgentDraft): Promise<void> {
    setSaving(true);
    setSubmitError(null);
    try {
      const restart = await props.api.save(customAgentInput(draft));
      setForm(null);
      setNote(t(RESTART_NOTE.saved[restart]));
    } catch (error) {
      setSubmitError(errorMessage(error, t("customProvider.agents.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function runCheck(draft: CustomAcpAgentDraft): Promise<void> {
    setCheck({ status: "checking" });
    try {
      setCheck(checkResult(await props.api.check(customAgentCheckInput(draft, form()?.saved?.id))));
    } catch (error) {
      setCheck({ status: "failed", message: errorMessage(error, t("customProvider.acp.checkFailed")) });
    }
  }

  async function remove(agent: CustomAgentSummary): Promise<void> {
    setRemoving(agent.id);
    setNote(null);
    try {
      setNote(t(RESTART_NOTE.removed[await props.api.remove(agent.id)]));
    } catch (error) {
      setNote(errorMessage(error, t("customProvider.removeFailed", { name: agent.name })));
    } finally {
      setRemoving(null);
    }
  }

  function confirmRemoval(): void {
    const agent = confirming();
    setConfirming(null);
    if (agent) void remove(agent);
  }

  const detail = (agent: CustomAgentSummary) => {
    const command = [agent.resolvedCommand ?? agent.command, ...agent.args].join(" ");
    const parts = [agent.resolvedCommand ? command : t("customProvider.agents.commandMissing", { command })];
    if (agent.envNames.length > 0) parts.push(t("customProvider.agents.envCount", { count: agent.envNames.length }));
    return parts.join(" · ");
  };

  return (
    <SettingsSection
      title={t("customProvider.agents.title")}
      description={t("customProvider.agents.description")}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={removing() !== null}
          onClick={() => open({ draft: emptyCustomAcpAgentDraft() })}
        >
          <Plus size={14} aria-hidden="true" />
          {t("customProvider.agents.add")}
        </Button>
      }
    >
      <Show
        when={props.api.agents.length > 0}
        fallback={
          <Text tone="muted" variant="caption">
            {t("customProvider.agents.empty")}
          </Text>
        }
      >
        <ItemGroup class="settings-modal-card" aria-label={t("customProvider.agents.title")}>
          <For each={props.api.agents}>
            {(agent) => (
              <Item>
                <ItemContent>
                  <ItemTitle>{agent.name}</ItemTitle>
                  <ItemDescription class="custom-acp-code">{detail(agent)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("customProvider.agents.editLabel", { name: agent.name })}
                    disabled={removing() !== null}
                    onClick={() => open({ draft: savedAcpAgentDraft(agent), saved: agent })}
                  >
                    <Pencil size={14} aria-hidden="true" />
                    {t("customProvider.detected.edit")}
                  </Button>
                  <Button
                    variant="destructive-ghost"
                    size="sm"
                    aria-label={t("customProvider.agents.deleteLabel", { name: agent.name })}
                    disabled={removing() !== null}
                    onClick={() => setConfirming(agent)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {t("common.delete")}
                  </Button>
                </ItemActions>
              </Item>
            )}
          </For>
        </ItemGroup>
      </Show>
      <Show when={note()}>
        {(message) => (
          <Text tone="muted" variant="caption" role="status">
            {message()}
          </Text>
        )}
      </Show>
      <CustomAcpAgentDialog
        open={form() !== null}
        draft={form()?.draft}
        editing={Boolean(form()?.saved)}
        presets={ACP_AGENT_PRESETS}
        check={check()}
        onCheck={(draft) => void runCheck(draft)}
        busy={saving()}
        submitError={submitError()}
        takenAgentIds={props.api.agents.map((agent) => agent.id).filter((id) => id !== form()?.saved?.id)}
        onSubmit={(draft) => void submit(draft)}
        onCancel={() => setForm(null)}
      />
      <ConfirmDialog
        open={confirming() !== null}
        title={t("customProvider.list.confirmTitle", { name: confirming()?.name ?? "" })}
        description={t("customProvider.agents.confirmDescription")}
        confirmLabel={t("common.remove")}
        onCancel={() => setConfirming(null)}
        onConfirm={confirmRemoval}
      />
    </SettingsSection>
  );
}
