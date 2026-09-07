import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentProfileDraft,
  AVATAR_HUES,
  type GenerateAgentProfileInput,
  type SaveAgentProfileInput,
  type SidebarSection,
} from "@openbot/contracts/ipc";
import { createStore, For, Show } from "solid-js";
import {
  Button,
  Dialog,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "../../components/ui";
import { createScopeGuard } from "../../scope-lifetime";
import { AgentAvatar } from "./AgentAvatar";

export interface AgentProfileSetupProps {
  agentId?: string;
  initialDraft?: AgentProfileDraft;
  sections: SidebarSection[];
  generate: (input: GenerateAgentProfileInput) => Promise<AgentProfileDraft>;
  save: (input: SaveAgentProfileInput, pending?: SaveAgentProfileInput) => Promise<void>;
  onClose: () => void;
}

/** Generated fields remain a draft until the explicit confirmation, including in the editing flow. */
export function AgentProfileSetup(props: AgentProfileSetupProps) {
  const [state, setState] = createStore({
    prompt: "",
    draft: props.initialDraft ? { ...props.initialDraft } : null,
    busy: false,
    saving: false,
    error: "",
    generated: false,
    operationId: crypto.randomUUID(),
  });
  const active = createScopeGuard();
  let pendingSave: SaveAgentProfileInput | undefined;
  const update = (patch: Partial<AgentProfileDraft>) =>
    setState((current) => {
      if (current.draft) Object.assign(current.draft, patch);
      current.operationId = crypto.randomUUID();
    });
  async function generate() {
    if (state.busy || !state.prompt.trim()) return;
    setState((current) => {
      current.busy = true;
      current.error = "";
    });
    try {
      const draft = await props.generate({
        prompt: state.prompt,
        ...(props.agentId ? { agentId: props.agentId } : {}),
        ...(state.draft ? { draft: { ...state.draft } } : {}),
      });
      if (active())
        setState((current) => {
          current.draft = { ...draft };
          current.generated = true;
          current.operationId = crypto.randomUUID();
        });
    } catch (error) {
      if (active())
        setState((current) => {
          current.error = error instanceof Error ? error.message : "Could not generate the profile.";
        });
    } finally {
      if (active())
        setState((current) => {
          current.busy = false;
        });
    }
  }
  async function save() {
    if (!state.draft || state.busy || !state.draft.name.trim() || !state.draft.description.trim()) return;
    const draft = { ...state.draft };
    setState((current) => {
      current.busy = true;
      current.saving = true;
      current.error = "";
    });
    try {
      const input = {
        operationId: state.operationId,
        draft,
        ...(props.agentId
          ? { agentId: props.agentId }
          : {
              initialMessage: `Introduce yourself briefly and explain how you can help. Your standing instructions: ${draft.description}`,
            }),
      };
      const previous = pendingSave;
      pendingSave ??= input;
      await props.save(input, previous);
      if (active()) props.onClose();
    } catch (error) {
      if (active())
        setState((current) => {
          current.error = error instanceof Error ? error.message : "Could not save the profile.";
        });
    } finally {
      if (active())
        setState((current) => {
          current.busy = false;
          current.saving = false;
        });
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !state.saving) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="agent-profile-overlay" />
        <Dialog.Content class="agent-profile-dialog">
          <Dialog.Title>{props.agentId ? "Revise agent profile" : "Create an agent from a prompt"}</Dialog.Title>
          <Dialog.Description>Describe the role, then review and edit the profile before saving.</Dialog.Description>
          <Field label="Describe your agent">
            <Textarea
              value={state.prompt}
              maxlength={INPUT_LIMITS.messageText}
              rows={3}
              disabled={state.busy}
              onValueChange={(prompt) =>
                setState((current) => {
                  current.prompt = prompt;
                })
              }
            />
          </Field>
          <Button
            disabled={state.busy || !state.prompt.trim()}
            loading={state.busy && !state.saving}
            loadingLabel="Generating profile…"
            onClick={() => void generate()}
          >
            {state.generated ? "Revise profile" : "Generate profile"}
          </Button>
          <Show when={state.draft}>
            {(draft) => (
              <fieldset disabled={state.busy} class="agent-profile-fields">
                <legend>Review profile</legend>
                <Field label="Name">
                  <Input
                    value={draft().name}
                    maxlength={INPUT_LIMITS.agentName}
                    onValueChange={(name) => update({ name })}
                  />
                </Field>
                <Field label="Title">
                  <Input
                    value={draft().title}
                    maxlength={INPUT_LIMITS.agentTitle}
                    onValueChange={(title) => update({ title })}
                  />
                </Field>
                <Field label="Standing instructions">
                  <Textarea
                    value={draft().description}
                    maxlength={INPUT_LIMITS.agentDescription}
                    rows={5}
                    onValueChange={(description) => update({ description })}
                  />
                </Field>
                <div class="agent-profile-avatar">
                  <AgentAvatar seed={draft().avatarSeed} hue={draft().avatarHue} motion="idle" />
                  <Button variant="outline" onClick={() => update({ avatarSeed: `profile:${crypto.randomUUID()}` })}>
                    Change face
                  </Button>
                </div>
                <fieldset>
                  <legend>Avatar color</legend>
                  <div class="agent-profile-colors">
                    <Button
                      variant="outline"
                      aria-pressed={draft().avatarHue === null ? "true" : "false"}
                      onClick={() => update({ avatarHue: null })}
                    >
                      Automatic
                    </Button>
                    <For each={AVATAR_HUES}>
                      {(hue) => (
                        <Button
                          variant="outline"
                          aria-label={`Avatar color ${hue}`}
                          aria-pressed={draft().avatarHue === hue ? "true" : "false"}
                          onClick={() => update({ avatarHue: hue })}
                        >
                          <AgentAvatar seed={draft().avatarSeed} hue={hue} motion="idle" />
                        </Button>
                      )}
                    </For>
                  </div>
                </fieldset>
                <Select<string>
                  options={["unassigned", ...props.sections.map((section) => section.id)]}
                  value={draft().sectionId ?? "unassigned"}
                  onChange={(value) => update({ sectionId: value === "unassigned" ? null : value })}
                  itemComponent={(item) => (
                    <SelectItem item={item.item}>
                      {props.sections.find((section) => section.id === item.item.rawValue)?.name ?? "Unassigned"}
                    </SelectItem>
                  )}
                >
                  <SelectTrigger aria-label="Sidebar section">
                    <SelectValue<string>>
                      {(value) =>
                        props.sections.find((section) => section.id === value.selectedOption())?.name ?? "Unassigned"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </fieldset>
            )}
          </Show>
          <Show when={state.error}>
            <p role="alert">{state.error}</p>
          </Show>
          <div class="agent-profile-actions">
            <Button variant="outline" disabled={state.saving} onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              disabled={!state.generated || state.busy || !state.draft?.name.trim() || !state.draft?.description.trim()}
              loading={state.saving}
              loadingLabel="Saving profile…"
              onClick={() => void save()}
            >
              {props.agentId ? "Save changes" : "Create agent"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
