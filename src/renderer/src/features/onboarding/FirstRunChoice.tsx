import { ProviderLogo, type ProviderLogoVariant } from "@openbot/brand";
import { Button, ChevronRight, Spinner } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { createUniqueId, For, Show } from "solid-js";
import type { OnboardingAvatarVariant } from "./onboarding-avatars";

export interface FirstRunChoiceProps {
  /** The agents over the title. The splash shows the same ones. */
  team: readonly OnboardingAvatarVariant[];
  disabled: boolean;
  /** The user started free and setup ends when the free provider is ready. */
  loading: boolean;
  /** Why "Start free" still waits, or why the free provider failed. Empty when nothing blocks it. */
  reason: string;
  onStartFree: () => void;
  /** Opens the list of plan providers. */
  onUsePlan: () => void;
}

const PLAN_LOGOS: readonly ProviderLogoVariant[] = ["codex", "claude", "grok"];

/**
 * The first question of first run: start free now, or connect a subscription the user already has.
 * The two answers are rows of one grouped list, with the same weight.
 */
export function FirstRunChoice(props: FirstRunChoiceProps) {
  const { t } = useText();
  const reasonId = createUniqueId();
  const freeDetailId = createUniqueId();
  const planDetailId = createUniqueId();
  const freeDescribedBy = () => (props.reason ? `${freeDetailId} ${reasonId}` : freeDetailId);
  return (
    <section class="first-run-choice" aria-labelledby="onboarding-title">
      <div class="first-run-choice-team" aria-hidden="true">
        <For each={props.team}>
          {(member) => (
            <AgentAvatar
              seed={member.seed}
              hue={member.hue}
              motion="idle"
              cycleOffset={member.cycleOffset}
              animationOffset={member.animationOffset}
              followPointer
              class="first-run-choice-avatar"
            />
          )}
        </For>
      </div>
      <h1 id="onboarding-title" class="first-run-choice-title">
        {t("onboarding.choice.title")}
      </h1>
      <p class="onboarding-description">{t("onboarding.choice.description")}</p>
      <div class="first-run-choice-rows">
        {/* The name is the title alone; the detail line describes the answer. */}
        <Button
          type="button"
          variant="ghost"
          class="first-run-choice-row"
          disabled={props.disabled || props.loading}
          aria-busy={props.loading ? "true" : undefined}
          aria-label={t("onboarding.choice.startFree")}
          aria-describedby={freeDescribedBy()}
          onClick={() => props.onStartFree()}
        >
          <span class="first-run-choice-row-text">
            <strong>{t("onboarding.choice.startFree")}</strong>
            <span id={freeDetailId}>{t("onboarding.choice.freeDetail")}</span>
          </span>
          <Show
            when={props.loading}
            fallback={<ChevronRight class="first-run-choice-row-chevron" aria-hidden="true" />}
          >
            <Spinner size="sm" label={t("onboarding.opening")} />
          </Show>
        </Button>
        <Button
          type="button"
          variant="ghost"
          class="first-run-choice-row"
          disabled={props.disabled}
          aria-label={t("onboarding.choice.subscription")}
          aria-describedby={planDetailId}
          onClick={() => props.onUsePlan()}
        >
          <span class="first-run-choice-row-text">
            <strong>{t("onboarding.choice.subscription")}</strong>
            <span id={planDetailId}>{t("onboarding.choice.subscriptionDetail")}</span>
          </span>
          <span class="first-run-choice-logos" aria-hidden="true">
            <For each={PLAN_LOGOS}>
              {(provider) => <ProviderLogo provider={provider} class="first-run-choice-logo" />}
            </For>
          </span>
          <ChevronRight class="first-run-choice-row-chevron" aria-hidden="true" />
        </Button>
      </div>
      <Show when={props.reason}>
        {(reason) => (
          <p class="onboarding-next-reason first-run-choice-reason" id={reasonId}>
            {reason()}
          </p>
        )}
      </Show>
    </section>
  );
}
