/**
 * A new agent, asked for where the user right-clicked: its face, its name, what it does and the
 * model it runs on. Enter creates it, Escape or a click on Cancel drops it. The face is picked at
 * random, as on the first agent form; the agent's settings can change it later. Without a model
 * catalog, the host picks the model.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentStatus,
  CustomAgentSummary,
  CustomProviderSummary,
} from "@openbot/contracts/ipc";
import { Button, Input } from "@openbot/ui";
import { createSignal, onSettled, Show } from "solid-js";
import { ProviderModelPicker } from "../../components/ProviderModelPicker";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { createFirstAgentDraft, type FirstAgentDraft } from "../agents/FirstAgentSetup";

export type DiagramNewAgentDraft = Pick<FirstAgentDraft, "name" | "purpose" | "avatarSeed" | "avatarHue"> &
  Partial<Pick<FirstAgentDraft, "provider" | "model">>;

/** What the model picker of a new agent offers, and the model it starts on. */
export interface DiagramModelChoice {
  options: AgentModelOption[];
  status: AgentStatus;
  initial: { provider: AgentProviderId; model: AgentModelId };
  customProviders?: readonly CustomProviderSummary[] | undefined;
  customAgents?: readonly CustomAgentSummary[] | undefined;
}

export function DiagramNewAgentCard(props: {
  /** Where the card opens, in pixels from the canvas's top left corner. */
  at: { x: number; y: number };
  models?: DiagramModelChoice | undefined;
  onCreate: (draft: DiagramNewAgentDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useText();
  const face = createFirstAgentDraft();
  const [name, setName] = createSignal("");
  const [purpose, setPurpose] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [choice, setChoice] = createSignal(props.models?.initial ?? null);
  let nameInput: HTMLInputElement | undefined;
  onSettled(() => nameInput?.focus());
  const create = () => {
    if (!name().trim() || busy()) return;
    setBusy(true);
    props
      .onCreate({
        name: name().trim(),
        purpose: purpose().trim(),
        avatarSeed: face.avatarSeed,
        avatarHue: face.avatarHue,
        ...(choice() ?? {}),
      })
      .catch(() => setBusy(false));
  };
  return (
    <form
      class="diagram-new-agent"
      style={{ "--diagram-new-agent-x": `${props.at.x}px`, "--diagram-new-agent-y": `${props.at.y}px` }}
      aria-label={t("diagram.newAgent.label")}
      data-diagram-overlay=""
      onSubmit={(event: SubmitEvent) => {
        event.preventDefault();
        create();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Escape" || busy()) return;
        event.preventDefault();
        props.onCancel();
      }}
    >
      <header class="diagram-new-agent-header">
        <AgentAvatar seed={face.avatarSeed} hue={face.avatarHue} class="diagram-new-agent-avatar" motion="idle" />
        <span>{t("diagram.newAgent.label")}</span>
      </header>
      <Input
        ref={(element: HTMLInputElement) => (nameInput = element)}
        size="sm"
        value={name()}
        placeholder={t("diagram.newAgent.namePlaceholder")}
        aria-label={t("diagram.newAgent.name")}
        maxlength={INPUT_LIMITS.agentName}
        disabled={busy()}
        onValueChange={setName}
      />
      <Input
        size="sm"
        value={purpose()}
        placeholder={t("diagram.newAgent.purposePlaceholder")}
        aria-label={t("diagram.newAgent.purpose")}
        disabled={busy()}
        maxlength={INPUT_LIMITS.agentDescription}
        onValueChange={setPurpose}
      />
      <Show when={props.models}>
        {(models) => (
          <Show when={choice()}>
            {(chosen) => (
              <ProviderModelPicker
                variant="field"
                ariaLabel={t("diagram.newAgent.model")}
                provider={chosen().provider}
                value={chosen().model}
                modelOptions={models().options}
                agentStatus={models().status}
                customProviders={models().customProviders}
                customAgents={models().customAgents}
                disabled={busy()}
                onChange={(next, provider) => setChoice({ provider, model: next })}
              />
            )}
          </Show>
        )}
      </Show>
      <div class="diagram-new-agent-actions">
        <Button type="button" variant="ghost" size="xs" disabled={busy()} onClick={() => props.onCancel()}>
          {t("diagram.newAgent.cancel")}
        </Button>
        <Button type="submit" size="xs" disabled={!name().trim() || busy()}>
          {busy() ? t("diagram.newAgent.creating") : t("diagram.newAgent.create")}
        </Button>
      </div>
    </form>
  );
}
