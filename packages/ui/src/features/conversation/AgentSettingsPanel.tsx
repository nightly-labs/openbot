import { agentProviderName } from "@openbot/contracts/agent-providers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_ACCESS_MODES,
  type AgentAccess,
  type AgentModelId,
  type AgentModelOption,
  type AgentProviderId,
  type AgentReasoningEffort,
  type AgentStatus,
  type AvatarHue,
  type AvatarImageInput,
  agentComputerUseEnabled,
  type CustomProviderSummary,
  DEFAULT_AGENT_ACCESS,
  enforcesWorkspaceAccess,
  type ProviderRuntimeStatus,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import {
  Button,
  ConfirmDialog,
  Input,
  Popover,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  Switch,
  Text,
  Textarea,
} from "@openbot/ui";
import { normalizeAvatarFile } from "@openbot/ui/avatar-image";
import { AVATAR_HUE_OPTIONS, avatarCandidateSeeds, avatarHueSwatch } from "@openbot/ui/bloub-avatar";
import { ProviderModelPicker, reasoningLabel } from "@openbot/ui/components/ProviderModelPicker";
import {
  SettingsField,
  SettingsPanel,
  SettingsPanelContent,
  SettingsPanelHeader,
} from "@openbot/ui/components/SettingsPanel";
import type { AgentProfile } from "@openbot/ui/data";
import { errorMessage } from "@openbot/ui/error-message";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createStore, For, onCleanup, onSettled, Show } from "solid-js";

export interface AgentRuntimeSettings {
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
}

export type AgentRuntimeSettingsPatch = AgentRuntimeSettings | Pick<AgentRuntimeSettings, "reasoningEffort">;

export interface AgentSettingsPanelProps {
  agent: AgentProfile;
  runtimeSettings: AgentRuntimeSettings;
  agentStatus: AgentStatus;
  modelOptions: AgentModelOption[];
  working: boolean;
  /** Access belongs to the computer that runs the agent, so a remote server hides the control. */
  accessEditable?: boolean;
  /** Computer Use is local-only too, and no remote host administers it yet. */
  computerUseEditable?: boolean;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>>;
  /** The caller supplies providers available on the selected host. */
  customProviders?: readonly CustomProviderSummary[];
  onDownloadProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onCancelProviderDownload?: (provider: AgentProviderId) => void | Promise<void>;
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>;
  maxWidth: () => number;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  /** Application-owned navigation and detail surfaces, in the existing panel layout. */
  links?: JSX.Element;
  detailOpen?: boolean;
  children?: JSX.Element;
  onUpdateAgent: (agentId: string, updates: Omit<UpdateAgentInput, "agentId">) => Promise<void>;
  onUpdateRuntimeSettings: (
    agentId: string,
    settings: AgentRuntimeSettings,
    updates: AgentRuntimeSettingsPatch,
  ) => Promise<boolean>;
  onSetAgentAvatar: (agentId: string, image: AvatarImageInput | null) => Promise<void>;
}

const INSTRUCTIONS_SAVE_DELAY_MS = 400;

/** The three free-text fields of the panel, each with a flag for edits made since the last save. */
interface AgentTextFields {
  description: string;
  name: string;
  title: string;
}

interface AvatarEditor {
  batch: number;
  candidateSeed: string;
  hue: AvatarHue | null;
  pickerOpen: boolean;
  seed: string;
  uploadBusy: boolean;
}

/**
 * Everything the panel is editing for the agent it currently shows. `fields` and `dirty` stay
 * parallel records so the props sync can write every field the user has not touched; `runtime` is
 * one record because the three settings are sent, and rolled back, together.
 */
interface AgentSettingsDraft {
  avatar: AvatarEditor;
  dirty: Record<keyof AgentTextFields, boolean>;
  fields: AgentTextFields;
  notifications: boolean;
  access: AgentAccess;
  computerUse: boolean;
  /** Widening to full access waits here for the confirmation. */
  confirmingFullAccess: boolean;
  runtime: AgentRuntimeSettings;
  saveError: string | null;
}

interface TextSaveRequest {
  agentId: string;
  draftValue: string;
  field: keyof AgentTextFields;
  storedValue: string;
}

export default function AgentSettingsPanel(props: AgentSettingsPanelProps) {
  const [draft, setDraft] = createStore<AgentSettingsDraft>({
    avatar: {
      batch: 0,
      candidateSeed: "agent",
      hue: null,
      pickerOpen: false,
      seed: "agent",
      uploadBusy: false,
    },
    dirty: { description: false, name: false, title: false },
    fields: { description: "", name: "", title: "" },
    notifications: true,
    access: DEFAULT_AGENT_ACCESS,
    computerUse: true,
    confirmingFullAccess: false,
    runtime: { model: "gpt-5.6-luna", provider: props.agent.provider, reasoningEffort: "medium" },
    saveError: null,
  });
  const avatarUrl = () => props.agent.avatarUrl ?? null;

  /** The message under the form: every save path clears it first and reports its failure through it. */
  function setSaveError(message: string | null): void {
    setDraft((state) => {
      state.saveError = message;
    });
  }

  const selectedModel = createMemo(() =>
    props.modelOptions.find(
      (option) => option.provider === draft.runtime.provider && option.id === draft.runtime.model,
    ),
  );
  const reasoningOptions = createMemo(() => selectedModel()?.supportedReasoningEfforts ?? ["medium" as const]);
  const avatarCandidates = createMemo(() =>
    avatarCandidateSeeds(props.agent.id, draft.avatar.candidateSeed, draft.avatar.batch),
  );
  let avatarPickerRoot: HTMLDivElement | undefined;
  let avatarFileInput: HTMLInputElement | undefined;
  let lastSignature: string | undefined;
  let lastAgentId: string | undefined;
  // Instructions save while the field remains focused. One queue also keeps blur, panel-close and
  // agent-change saves ordered, so an older completion cannot declare a newer draft clean.
  let instructionsSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let activeTextSave: TextSaveRequest | null = null;
  let disposed = false;
  const pendingTextSaves = new Map<string, TextSaveRequest>();

  createEffect(
    () => {
      const agent = props.agent;
      const runtimeSettings = props.runtimeSettings;
      return {
        agent,
        runtimeSettings,
        signature: [
          agent.id,
          agent.name,
          agent.title,
          agent.description,
          String(agent.notifications),
          agent.access ?? DEFAULT_AGENT_ACCESS,
          String(agentComputerUseEnabled(agent)),
          runtimeSettings.provider,
          runtimeSettings.model,
          runtimeSettings.reasoningEffort,
          agent.avatarSeed,
          String(agent.avatarHue),
        ].join("\u0000"),
      };
    },
    ({ agent, runtimeSettings, signature }) => {
      if (signature === lastSignature) return;
      const agentChanged = agent.id !== lastAgentId;
      if (agentChanged && lastAgentId) flushDirtyTextFields(lastAgentId);
      // A field the user has edited keeps its draft, unless this is a different agent, whose values
      // replace the panel wholesale. Read before the write, so a fresh agent clears the flags here.
      const keep = {
        description: !agentChanged && draft.dirty.description,
        name: !agentChanged && draft.dirty.name,
        title: !agentChanged && draft.dirty.title,
      };
      lastSignature = signature;
      lastAgentId = agent.id;
      setDraft((state) => {
        if (agentChanged) {
          state.dirty.description = false;
          state.dirty.name = false;
          state.dirty.title = false;
        }
        if (!keep.name) state.fields.name = agent.name;
        if (!keep.title) state.fields.title = agent.title;
        if (!keep.description) state.fields.description = agent.description;
        state.notifications = agent.notifications;
        state.access = agent.access ?? DEFAULT_AGENT_ACCESS;
        state.computerUse = agentComputerUseEnabled(agent);
        if (agentChanged) state.confirmingFullAccess = false;
        state.runtime.provider = runtimeSettings.provider;
        state.runtime.model = runtimeSettings.model;
        state.runtime.reasoningEffort = runtimeSettings.reasoningEffort;
        state.avatar.seed = agent.avatarSeed;
        state.avatar.hue = agent.avatarHue;
        if (agentChanged) {
          state.avatar.candidateSeed = agent.avatarSeed;
          state.avatar.batch = 0;
          state.avatar.pickerOpen = false;
        }
      });
    },
  );

  onSettled(() => {
    const closeAvatarPicker = (event: PointerEvent) => {
      if (!draft.avatar.pickerOpen) return;
      if (event.target instanceof Node && avatarPickerRoot?.contains(event.target)) return;
      setDraft((state) => {
        state.avatar.pickerOpen = false;
      });
    };
    window.addEventListener("pointerdown", closeAvatarPicker);
    return () => window.removeEventListener("pointerdown", closeAvatarPicker);
  });

  onCleanup(() => {
    if (lastAgentId) flushDirtyTextFields(lastAgentId);
    disposed = true;
  });

  async function saveAgentPatch(
    updates: Omit<UpdateAgentInput, "agentId">,
    agentId = props.agent.id,
  ): Promise<boolean> {
    if (!disposed && props.agent.id === agentId) setSaveError(null);
    try {
      await props.onUpdateAgent(agentId, updates);
      return true;
    } catch (error) {
      if (!disposed && props.agent.id === agentId) {
        setSaveError(errorMessage(error, "Could not save agent settings."));
      }
      return false;
    }
  }

  function textSaveRequest(
    field: keyof AgentTextFields,
    agentId: string,
    draftValue = draft.fields[field],
  ): TextSaveRequest {
    return {
      agentId,
      draftValue,
      field,
      storedValue:
        field === "name" ? draftValue.trim() || "New agent" : field === "title" ? draftValue.trim() : draftValue,
    };
  }

  function textSaveKey(request: TextSaveRequest): string {
    return `${request.agentId}\u0000${request.field}`;
  }

  function textSavePatch(request: TextSaveRequest): Omit<UpdateAgentInput, "agentId"> {
    switch (request.field) {
      case "name":
        return { name: request.storedValue };
      case "title":
        return { title: request.storedValue };
      case "description":
        return { description: request.storedValue };
    }
  }

  function queueTextSave(request: TextSaveRequest): void {
    if (
      activeTextSave?.agentId === request.agentId &&
      activeTextSave.field === request.field &&
      activeTextSave.draftValue === request.draftValue
    ) {
      return;
    }
    pendingTextSaves.set(textSaveKey(request), request);
    void drainTextSaves();
  }

  async function drainTextSaves(): Promise<void> {
    if (activeTextSave) return;
    const entry = pendingTextSaves.entries().next().value;
    if (!entry) return;
    const [key, request] = entry;
    pendingTextSaves.delete(key);
    activeTextSave = request;
    const saved = await saveAgentPatch(textSavePatch(request), request.agentId);
    if (
      !disposed &&
      saved &&
      props.agent.id === request.agentId &&
      draft.fields[request.field] === request.draftValue
    ) {
      setDraft((state) => {
        state.dirty[request.field] = false;
      });
    }
    activeTextSave = null;
    if (pendingTextSaves.size > 0) void drainTextSaves();
  }

  function cancelInstructionsSaveTimer(): void {
    if (instructionsSaveTimer === undefined) return;
    clearTimeout(instructionsSaveTimer);
    instructionsSaveTimer = undefined;
  }

  function scheduleInstructionsSave(value: string): void {
    cancelInstructionsSaveTimer();
    const request = textSaveRequest("description", props.agent.id, value);
    instructionsSaveTimer = setTimeout(() => {
      instructionsSaveTimer = undefined;
      queueTextSave(request);
    }, INSTRUCTIONS_SAVE_DELAY_MS);
  }

  function flushDirtyTextFields(agentId: string): void {
    cancelInstructionsSaveTimer();
    for (const field of ["name", "title", "description"] as const) {
      if (draft.dirty[field]) queueTextSave(textSaveRequest(field, agentId));
    }
  }

  async function saveRuntimeSettings(
    settings: AgentRuntimeSettings,
    updates: AgentRuntimeSettingsPatch,
    agentId = props.agent.id,
  ): Promise<boolean> {
    setSaveError(null);
    try {
      const saved = await props.onUpdateRuntimeSettings(agentId, settings, updates);
      if (!saved && props.agent.id === agentId) setSaveError("Could not save agent settings.");
      return saved;
    } catch (error) {
      if (props.agent.id === agentId) {
        setSaveError(errorMessage(error, "Could not save agent settings."));
      }
      return false;
    }
  }

  function saveName(): void {
    const value = draft.fields.name.trim() || "New agent";
    setDraft((state) => {
      state.fields.name = value;
    });
    queueTextSave(textSaveRequest("name", props.agent.id));
  }

  function saveTitle(): void {
    const value = draft.fields.title.trim();
    setDraft((state) => {
      state.fields.title = value;
    });
    queueTextSave(textSaveRequest("title", props.agent.id));
  }

  function saveDescription(): void {
    cancelInstructionsSaveTimer();
    queueTextSave(textSaveRequest("description", props.agent.id));
  }

  async function setCustomAvatar(image: AvatarImageInput | null): Promise<boolean> {
    if (draft.avatar.uploadBusy) return false;
    setDraft((state) => {
      state.avatar.uploadBusy = true;
      state.saveError = null;
    });
    try {
      await props.onSetAgentAvatar(props.agent.id, image);
      return true;
    } catch (error) {
      setSaveError(errorMessage(error, "Could not save the agent avatar."));
      return false;
    } finally {
      setDraft((state) => {
        state.avatar.uploadBusy = false;
      });
    }
  }

  async function uploadAgentAvatar(file: File | undefined): Promise<void> {
    if (!file) return;
    setDraft((state) => {
      state.avatar.uploadBusy = true;
      state.saveError = null;
    });
    try {
      const image = await normalizeAvatarFile(file);
      await props.onSetAgentAvatar(props.agent.id, image);
    } catch (error) {
      setSaveError(errorMessage(error, "Could not process the agent avatar."));
    } finally {
      setDraft((state) => {
        state.avatar.uploadBusy = false;
      });
      if (avatarFileInput) avatarFileInput.value = "";
    }
  }

  async function selectGeneratedAvatar(seed: string): Promise<void> {
    if (avatarUrl() && !(await setCustomAvatar(null))) return;
    setDraft((state) => {
      state.avatar.seed = seed;
    });
    await saveAgentPatch({ avatarSeed: seed });
  }

  async function selectModel(nextModel: AgentModelId, nextProvider: AgentProviderId): Promise<void> {
    const option = props.modelOptions.find(
      (candidate) => candidate.provider === nextProvider && candidate.id === nextModel,
    );
    if (!option) return;
    // A plain copy, not `snapshot`: a snapshot of an unmodified subtree is the store's own object,
    // which the write below would mutate, leaving nothing to roll back to.
    const previous: AgentRuntimeSettings = {
      model: draft.runtime.model,
      provider: draft.runtime.provider,
      reasoningEffort: draft.runtime.reasoningEffort,
    };
    const agentId = props.agent.id;
    const settings: AgentRuntimeSettings = {
      model: nextModel,
      provider: nextProvider,
      reasoningEffort: option.supportedReasoningEfforts.includes(previous.reasoningEffort)
        ? previous.reasoningEffort
        : option.defaultReasoningEffort,
    };
    setDraft((state) => {
      state.runtime.provider = settings.provider;
      state.runtime.model = settings.model;
      state.runtime.reasoningEffort = settings.reasoningEffort;
    });
    if (await saveRuntimeSettings(settings, settings, agentId)) return;
    // Roll back only what this call wrote: another agent, or a later pick, owns the panel now.
    if (props.agent.id !== agentId || !sameRuntimeSettings(draft.runtime, settings)) return;
    setDraft((state) => {
      state.runtime.provider = previous.provider;
      state.runtime.model = previous.model;
      state.runtime.reasoningEffort = previous.reasoningEffort;
    });
  }

  async function selectReasoning(nextReasoning: AgentReasoningEffort): Promise<void> {
    const agentId = props.agent.id;
    const previousReasoning = draft.runtime.reasoningEffort;
    const settings: AgentRuntimeSettings = {
      model: draft.runtime.model,
      provider: draft.runtime.provider,
      reasoningEffort: nextReasoning,
    };
    setDraft((state) => {
      state.runtime.reasoningEffort = nextReasoning;
    });
    if (await saveRuntimeSettings(settings, { reasoningEffort: nextReasoning }, agentId)) return;
    if (props.agent.id === agentId && sameRuntimeSettings(draft.runtime, settings)) {
      setDraft((state) => {
        state.runtime.reasoningEffort = previousReasoning;
      });
    }
  }

  async function saveAccess(nextAccess: AgentAccess): Promise<void> {
    const agentId = props.agent.id;
    const previousAccess = draft.access;
    setDraft((state) => {
      state.access = nextAccess;
    });
    if (await saveAgentPatch({ access: nextAccess }, agentId)) return;
    if (!disposed && props.agent.id === agentId && draft.access === nextAccess) {
      setDraft((state) => {
        state.access = previousAccess;
      });
    }
  }

  async function saveComputerUse(next: boolean): Promise<void> {
    const agentId = props.agent.id;
    setDraft((state) => {
      state.computerUse = next;
    });
    if (await saveAgentPatch({ computerUse: next }, agentId)) return;
    if (!disposed && props.agent.id === agentId && draft.computerUse === next) {
      setDraft((state) => {
        state.computerUse = !next;
      });
    }
  }

  return (
    <SettingsPanel
      onResizeEnd={props.onResizeEnd}
      id="settings-side-panel"
      label="Agent settings"
      width={props.width}
      maxWidth={props.maxWidth}
      onResize={props.onResize}
    >
      <Show when={!props.detailOpen}>
        <SettingsPanelHeader
          title="Settings"
          onBack={props.onClose}
          backLabel="Back to details"
          onClose={props.onClose}
          closeLabel="Close details"
        />
      </Show>
      <Show when={!props.detailOpen}>
        <SettingsPanelContent>
          <div ref={(element) => (avatarPickerRoot = element)} class="agent-settings-avatar-picker">
            <Popover.Root
              open={draft.avatar.pickerOpen}
              placement="bottom"
              gutter={11}
              onOpenChange={(open) =>
                setDraft((state) => {
                  if (open) {
                    state.avatar.candidateSeed = state.avatar.seed;
                    state.avatar.batch = 0;
                  }
                  state.avatar.pickerOpen = open;
                })
              }
            >
              <Popover.Trigger class="agent-settings-avatar" aria-label="Edit agent avatar">
                <AgentAvatar seed={draft.avatar.seed} hue={draft.avatar.hue} url={avatarUrl()} motion="always" />
              </Popover.Trigger>
              <Popover.Content class="avatar-editor" aria-hidden={draft.avatar.pickerOpen ? undefined : "true"}>
                <Popover.Title class="sr-only">Avatar editor</Popover.Title>
                <Input
                  ref={(element) => (avatarFileInput = element)}
                  class="sr-only"
                  type="file"
                  aria-label="Attach files"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => void uploadAgentAvatar(event.currentTarget.files?.[0])}
                />
                <div class="avatar-editor-heading">
                  <span>Image</span>
                  <div class="avatar-editor-actions">
                    <Show when={avatarUrl()}>
                      <Button
                        variant="outline"
                        type="button"
                        disabled={draft.avatar.uploadBusy}
                        onClick={() => void setCustomAvatar(null)}
                      >
                        Remove
                      </Button>
                    </Show>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  type="button"
                  class={["avatar-image-upload", { "avatar-image-upload-active": Boolean(avatarUrl()) }]}
                  disabled={draft.avatar.uploadBusy}
                  onClick={() => avatarFileInput?.click()}
                >
                  <span class="avatar-image-upload-preview">
                    <Show
                      when={avatarUrl()}
                      fallback={
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      }
                    >
                      <AgentAvatar seed={draft.avatar.seed} hue={draft.avatar.hue} url={avatarUrl()} />
                    </Show>
                  </span>
                  <span>
                    <strong>{avatarUrl() ? "Replace image" : "Upload image"}</strong>
                    <small>PNG, JPEG or WebP · square crop</small>
                  </span>
                </Button>
                <div class="avatar-editor-divider" />
                <div class="avatar-editor-heading">
                  <span>Generated face</span>
                  <div class="avatar-editor-actions">
                    <Show when={draft.avatar.seed !== props.agent.id}>
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => {
                          setDraft((state) => {
                            state.avatar.candidateSeed = props.agent.id;
                            state.avatar.batch = 0;
                          });
                          void selectGeneratedAvatar(props.agent.id);
                        }}
                      >
                        Reset to ID
                      </Button>
                    </Show>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() =>
                        setDraft((state) => {
                          state.avatar.candidateSeed = state.avatar.seed;
                          state.avatar.batch += 1;
                        })
                      }
                    >
                      New set
                    </Button>
                  </div>
                </div>
                <fieldset class="avatar-face-grid" aria-label="Generated avatar faces">
                  <For each={avatarCandidates()}>
                    {(seed, index) => (
                      <Button
                        variant="ghost"
                        type="button"
                        class={[
                          "avatar-face-choice",
                          { "avatar-choice-selected": !avatarUrl() && draft.avatar.seed === seed },
                        ]}
                        aria-label={
                          !avatarUrl() && draft.avatar.seed === seed
                            ? "Selected avatar"
                            : `Avatar option ${index() + 1}`
                        }
                        aria-pressed={!avatarUrl() && draft.avatar.seed === seed ? "true" : "false"}
                        onClick={() => void selectGeneratedAvatar(seed)}
                      >
                        <AgentAvatar seed={seed} hue={draft.avatar.hue} />
                      </Button>
                    )}
                  </For>
                </fieldset>
                <div class="avatar-editor-divider" />
                <div class="avatar-editor-heading">
                  <span>Color</span>
                </div>
                <fieldset class="avatar-color-grid" aria-label="Avatar color">
                  <Button
                    variant="ghost"
                    type="button"
                    class={["avatar-color-choice", { "avatar-choice-selected": draft.avatar.hue === null }]}
                    aria-label="Automatic avatar color"
                    aria-pressed={draft.avatar.hue === null ? "true" : "false"}
                    onClick={() => {
                      setDraft((state) => {
                        state.avatar.hue = null;
                      });
                      void saveAgentPatch({ avatarHue: null });
                    }}
                  >
                    <span class="avatar-color-swatch avatar-color-swatch-auto">A</span>
                  </Button>
                  <For each={AVATAR_HUE_OPTIONS}>
                    {(option) => (
                      <Button
                        variant="ghost"
                        type="button"
                        class={["avatar-color-choice", { "avatar-choice-selected": draft.avatar.hue === option.hue }]}
                        aria-label={`${option.label} avatar color`}
                        aria-pressed={draft.avatar.hue === option.hue ? "true" : "false"}
                        onClick={() => {
                          setDraft((state) => {
                            state.avatar.hue = option.hue;
                          });
                          void saveAgentPatch({ avatarHue: option.hue });
                        }}
                      >
                        <span class="avatar-color-swatch" style={{ background: avatarHueSwatch(option.hue) }} />
                      </Button>
                    )}
                  </For>
                </fieldset>
              </Popover.Content>
            </Popover.Root>
          </div>
          <SettingsField label="Name">
            <Input
              value={draft.fields.name}
              aria-label="Agent name"
              maxlength={INPUT_LIMITS.agentName}
              onValueChange={(value) =>
                setDraft((state) => {
                  state.fields.name = value;
                  state.dirty.name = true;
                })
              }
              onBlur={saveName}
            />
          </SettingsField>
          <SettingsField label="Title">
            <Input
              value={draft.fields.title}
              aria-label="Agent title"
              placeholder="Describe what your agent does"
              maxlength={INPUT_LIMITS.agentTitle}
              onValueChange={(value) =>
                setDraft((state) => {
                  state.fields.title = value;
                  state.dirty.title = true;
                })
              }
              onBlur={saveTitle}
            />
          </SettingsField>
          <SettingsField label="Instructions">
            <Textarea
              rows="4"
              value={draft.fields.description}
              aria-label="Agent instructions"
              placeholder="What this agent is for"
              maxlength={INPUT_LIMITS.agentDescription}
              onValueChange={(value) => {
                setDraft((state) => {
                  state.fields.description = value;
                  state.dirty.description = true;
                });
                scheduleInstructionsSave(value);
              }}
              onBlur={saveDescription}
            />
          </SettingsField>
          {props.links}
          <SettingsSection class="agent-settings-runtime" title="Runtime">
            <div class="agent-settings-runtime-rows">
              <ProviderModelPicker
                variant="field"
                ariaLabel="Agent model"
                provider={draft.runtime.provider}
                value={draft.runtime.model}
                agentStatus={props.agentStatus}
                modelOptions={props.modelOptions}
                runtimeStatuses={props.providerRuntimeStatuses}
                customProviders={props.customProviders}
                onDownloadProvider={props.onDownloadProvider}
                onCancelProviderDownload={props.onCancelProviderDownload}
                onConnectProvider={props.onConnectProvider}
                disabled={props.working}
                disabledReason={
                  props.working
                    ? "Wait for the current work to finish before changing models."
                    : "Models are available after an agent CLI connects."
                }
                onChange={(nextModel, provider) => void selectModel(nextModel, provider)}
              />
              <Select<AgentReasoningEffort>
                class="agent-settings-runtime-select"
                options={reasoningOptions()}
                value={draft.runtime.reasoningEffort}
                onChange={(nextReasoning) => {
                  if (!nextReasoning || nextReasoning === draft.runtime.reasoningEffort) return;
                  void selectReasoning(nextReasoning);
                }}
                itemComponent={(item) => <SelectItem item={item.item}>{reasoningLabel(item.item.rawValue)}</SelectItem>}
              >
                <SelectTrigger class="agent-settings-runtime-row" aria-label="Agent reasoning level">
                  <span class="agent-settings-runtime-label">Reasoning</span>
                  <SelectValue<AgentReasoningEffort>>
                    {(state) => {
                      const effort = state.selectedOption();
                      return effort ? reasoningLabel(effort) : "Select reasoning";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent />
              </Select>
              <Show when={props.accessEditable}>
                <Select<AgentAccess>
                  class="agent-settings-runtime-select"
                  options={[...AGENT_ACCESS_MODES]}
                  value={draft.access}
                  onChange={(nextAccess) => {
                    if (!nextAccess || nextAccess === draft.access) return;
                    // Widening is the move that needs the warning. Narrowing is never something a
                    // user needs protecting from, so it is written straight away.
                    if (nextAccess === "full") {
                      setDraft((state) => {
                        state.confirmingFullAccess = true;
                      });
                    } else void saveAccess(nextAccess);
                  }}
                  itemComponent={(item) => <SelectItem item={item.item}>{accessLabel(item.item.rawValue)}</SelectItem>}
                >
                  <SelectTrigger class="agent-settings-runtime-row" aria-label="Agent access">
                    <span class="agent-settings-runtime-label">Access</span>
                    <SelectValue<AgentAccess>>
                      {(state) => accessLabel(state.selectedOption() ?? DEFAULT_AGENT_ACCESS)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </Show>
              <div class="agent-settings-runtime-path">
                <span class="agent-settings-runtime-label">Working directory</span>
                <span>
                  {props.agent.workspacePath ? breakablePath(props.agent.workspacePath) : "Not available yet"}
                </span>
              </div>
            </div>
            <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
              <Show
                when={draft.access === "workspace"}
                fallback={
                  <>
                    The agent runs with full computer access from its workspace and the shared folder.{" "}
                    {draft.runtime.provider === "claude"
                      ? "Claude acts without asking for approval, except for questions it puts to you."
                      : "Depending on the provider, sensitive commands may ask for approval first."}
                  </>
                }
              >
                Workspace only limits writes to this agent's workspace and the shared folder. Reads and network stay
                available.{" "}
                <Show
                  when={enforcesWorkspaceAccess(draft.runtime.provider)}
                  fallback={
                    <>
                      {agentProviderName(draft.runtime.provider)} does not enforce it yet, so this agent still has full
                      access. Codex agents are enforced.
                    </>
                  }
                >
                  A command that must write outside asks you first, also when Auto approve is on. Computer Use and the
                  OpenBot browser are not limited; you can turn Computer Use off below.
                </Show>
              </Show>
            </Text>
          </SettingsSection>
          <Show when={draft.saveError}>
            {(message) => (
              <p class="agent-settings-save-error" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <Show when={props.computerUseEditable}>
            <div class="agent-settings-notifications">
              <div>
                <strong>Computer Use</strong>
                <span>Let this agent control apps on this computer</span>
              </div>
              <Switch
                size="sm"
                aria-label="Computer Use"
                checked={draft.computerUse}
                onChange={(next) => void saveComputerUse(next)}
              />
            </div>
          </Show>
          <div class="agent-settings-notifications">
            <div>
              <strong>Notifications</strong>
              <span>Get notified when this agent finishes or needs input</span>
            </div>
            <Switch
              size="sm"
              aria-label="Notifications"
              checked={draft.notifications}
              onChange={(next) => {
                setDraft((state) => {
                  state.notifications = next;
                });
                void saveAgentPatch({ notifications: next });
              }}
            />
          </div>
        </SettingsPanelContent>
        <ConfirmDialog
          open={draft.confirmingFullAccess}
          tone="default"
          initialFocus="cancel"
          title="Give this agent full access?"
          description="The agent can then read, change and delete any file your user account can reach, run any command, and use the network. One misunderstood instruction or a malicious web page can reach your personal files."
          cancelLabel="Keep workspace only"
          confirmLabel="Allow full access"
          onCancel={() =>
            setDraft((state) => {
              state.confirmingFullAccess = false;
            })
          }
          onConfirm={() => {
            setDraft((state) => {
              state.confirmingFullAccess = false;
            });
            void saveAccess("full");
          }}
        />
      </Show>
      {props.children}
    </SettingsPanel>
  );
}

/** Lets a long path wrap after a slash instead of inside a folder name. */
function breakablePath(path: string) {
  return path.split("/").map((part, index) =>
    index === 0 ? (
      part
    ) : (
      <>
        /<wbr />
        {part}
      </>
    ),
  );
}

/** True when the panel still shows exactly the settings a save was issued for. */
function sameRuntimeSettings(current: AgentRuntimeSettings, settings: AgentRuntimeSettings): boolean {
  return (
    current.provider === settings.provider &&
    current.model === settings.model &&
    current.reasoningEffort === settings.reasoningEffort
  );
}

function accessLabel(access: AgentAccess) {
  return access === "workspace" ? "Workspace only" : "Full access";
}
