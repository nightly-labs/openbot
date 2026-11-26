import type { ChannelDraft } from "@openbot/contracts/ipc";
import { Alert, AlertDescription, ArrowLeft, Button, Checkbox, Field, Input, Search } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createStore, For, Show } from "solid-js";
import { avatarAgent } from "./agent-look";
import type { Workspace } from "./workspace";

const FOLDER_NAME_MAX = 40;

function FormScreen(props: {
  title: string;
  submitLabel: string;
  canSubmit: boolean;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
  children: JSX.Element;
}) {
  const { t } = useText();
  return (
    <form
      class="ext-form-screen"
      onSubmit={(event) => {
        event.preventDefault();
        if (props.canSubmit && !props.busy) props.onSubmit();
      }}
    >
      <header class="ch-topbar">
        <button type="button" class="ch-back" aria-label={t("common.back")} onClick={() => props.onBack()}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <h1 class="ext-form-title">{props.title}</h1>
      </header>
      <div class="ext-form-body">
        <Show when={props.error}>
          {(message) => (
            <Alert tone="danger" role="alert">
              <AlertDescription>{message()}</AlertDescription>
            </Alert>
          )}
        </Show>
        {props.children}
      </div>
      <div class="ext-form-footer">
        <Button type="submit" disabled={!props.canSubmit || props.busy}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function NewChannelScreen(props: {
  workspace: Workspace;
  onClose: () => void;
  onCreated: (channelId: string) => void;
}) {
  const { t, errorMessage } = useText();
  const [form, setForm] = createStore<{ draft: ChannelDraft; search: string; busy: boolean; error: string | null }>({
    draft: { name: "", title: "", instructions: "", members: [], leadAgentId: null },
    search: "",
    busy: false,
    error: null,
  });
  const agents = createMemo(() => {
    const key = form.search.trim().toLowerCase();
    return props.workspace.state.agents.filter((agent) =>
      `${agent.name} ${agent.description}`.toLowerCase().includes(key),
    );
  });
  function toggle(agentId: string, present: boolean) {
    setForm((state) => {
      const members = state.draft.members.filter((member) => member.agentId !== agentId);
      state.draft.members = present ? [...members, { agentId }] : members;
      if (!state.draft.members.some((member) => member.agentId === state.draft.leadAgentId))
        state.draft.leadAgentId = state.draft.members[0]?.agentId ?? null;
    });
  }
  async function create() {
    setForm((state) => {
      state.busy = true;
      state.error = null;
    });
    try {
      const channelId = await props.workspace.createChannel({
        ...form.draft,
        name: form.draft.name.trim(),
        members: form.draft.members.map((member) => ({ agentId: member.agentId })),
      });
      props.onCreated(channelId);
    } catch (error) {
      setForm((state) => {
        state.error = errorMessage(error, t("extension.create.failed"));
      });
    } finally {
      setForm((state) => {
        state.busy = false;
      });
    }
  }
  return (
    <FormScreen
      title={t("sidebar.new.channel")}
      submitLabel={t("common.create")}
      canSubmit={form.draft.name.trim().length > 0 && form.draft.members.length > 0}
      busy={form.busy}
      error={form.error}
      onBack={props.onClose}
      onSubmit={() => void create()}
    >
      <Field label={t("channel.form.name")}>
        <Input
          size="lg"
          placeholder={t("channel.form.namePlaceholder")}
          required
          autofocus
          value={form.draft.name}
          onValueChange={(name) =>
            setForm((state) => {
              state.draft.name = name;
            })
          }
        />
      </Field>
      <fieldset class="ext-form-members">
        <legend>{t("channel.create.addAgents")}</legend>
        <label class="ext-form-search">
          <Search size={14} aria-hidden="true" />
          <Input
            type="search"
            aria-label={t("channel.create.searchAgents")}
            placeholder={t("channel.create.searchAgents")}
            value={form.search}
            onValueChange={(search) =>
              setForm((state) => {
                state.search = search;
              })
            }
          />
        </label>
        <For
          each={agents()}
          fallback={
            <p class="ph-none">
              {props.workspace.state.agents.length ? t("channel.create.noMatches") : t("channel.create.noAgentsHint")}
            </p>
          }
        >
          {(agent) => (
            <label class="ext-form-member" for={`ext-channel-member-${agent.id}`}>
              <Checkbox
                id={`ext-channel-member-${agent.id}`}
                checked={form.draft.members.some((member) => member.agentId === agent.id)}
                onChange={(event) => toggle(agent.id, event.currentTarget.checked)}
              />
              <AgentAvatar
                agent={avatarAgent(agent, props.workspace.state.colors[agent.id])}
                motion="idle"
                class="ext-form-face"
              />
              <span class="ph-row-text">
                <span class="ph-row-name">{agent.name}</span>
                <span class="ph-row-preview">{agent.description}</span>
              </span>
            </label>
          )}
        </For>
      </fieldset>
    </FormScreen>
  );
}

export function NewFolderScreen(props: { workspace: Workspace; onClose: () => void; onCreated: () => void }) {
  const { t, errorMessage } = useText();
  const [form, setForm] = createStore<{ name: string; busy: boolean; error: string | null }>({
    name: "",
    busy: false,
    error: null,
  });
  const taken = () => {
    const name = form.name.trim().toLowerCase();
    return props.workspace.state.folders.some((folder) => folder.name.trim().toLowerCase() === name);
  };
  async function create() {
    setForm((state) => {
      state.busy = true;
      state.error = null;
    });
    try {
      await props.workspace.createFolder(form.name.trim());
      props.onCreated();
    } catch (error) {
      setForm((state) => {
        state.error = errorMessage(error, t("sidebar.section.saveFailed"));
      });
    } finally {
      setForm((state) => {
        state.busy = false;
      });
    }
  }
  return (
    <FormScreen
      title={t("sidebar.new.section")}
      submitLabel={t("common.create")}
      canSubmit={form.name.trim().length > 0 && !taken()}
      busy={form.busy}
      error={form.error ?? (taken() ? t("sidebar.section.nameUnique") : null)}
      onBack={props.onClose}
      onSubmit={() => void create()}
    >
      <Field label={t("sidebar.section.newNameLabel")}>
        <Input
          size="lg"
          required
          autofocus
          maxlength={FOLDER_NAME_MAX}
          value={form.name}
          onValueChange={(name) =>
            setForm((state) => {
              state.name = name;
            })
          }
        />
      </Field>
    </FormScreen>
  );
}
