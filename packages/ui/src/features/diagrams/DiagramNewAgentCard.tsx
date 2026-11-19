import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentModelId,
  AgentProviderId,
  AgentStatus,
  ClientAgentModelOption,
  CustomAgentSummary,
  CustomProviderSummary,
} from "@openbot/contracts/ipc";
import { Button, Input } from "@openbot/ui";
import { createSignal, onSettled, Show } from "solid-js";
import { ProviderModelPicker } from "../../components/ProviderModelPicker";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { createFirstAgentDraft, type FirstAgentDraft } from "../agents/FirstAgentSetup";
import { InstructionsLimit, instructionsTooLong } from "../agents/InstructionsLimit";

export type DiagramNewAgentDraft = Pick<FirstAgentDraft, "name" | "purpose" | "avatarSeed" | "avatarHue"> &
  Partial<Pick<FirstAgentDraft, "provider" | "model">>;

export interface DiagramModelChoice {
  options: ClientAgentModelOption[];
  status: AgentStatus;
  initial: { provider: AgentProviderId; model: AgentModelId };
  customProviders?: readonly CustomProviderSummary[] | undefined;
  customAgents?: readonly CustomAgentSummary[] | undefined;
}

export function DiagramNewAgentCard(props: {
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
  const [height, setHeight] = createSignal<number | null>(null);
  let nameInput: HTMLInputElement | undefined;
  let form: HTMLFormElement | undefined;
  onSettled(() => {
    nameInput?.focus();
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (busy() || !(target instanceof Element)) return;
      if (form?.contains(target) || target.closest(".provider-model-popover, [data-popper-positioner]")) return;
      props.onCancel();
    };
    document.addEventListener("pointerdown", dismiss);
    const resize = new ResizeObserver(() => setHeight(form?.offsetHeight ?? null));
    if (form) resize.observe(form);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      resize.disconnect();
    };
  });
  const create = () => {
    if (!name().trim() || instructionsTooLong(purpose()) || busy()) return;
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
      ref={(element) => (form = element)}
      class="diagram-new-agent"
      style={{
        "--diagram-new-agent-x": `${props.at.x}px`,
        "--diagram-new-agent-y": `${props.at.y}px`,
        "--diagram-new-agent-height": height() === null ? undefined : `${height()}px`,
      }}
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
        invalid={instructionsTooLong(purpose())}
        onValueChange={setPurpose}
      />
      <InstructionsLimit text={purpose()} />
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
        <Button type="submit" size="xs" disabled={!name().trim() || instructionsTooLong(purpose()) || busy()}>
          {busy() ? t("diagram.newAgent.creating") : t("diagram.newAgent.create")}
        </Button>
      </div>
    </form>
  );
}
