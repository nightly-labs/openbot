import type { AgentModelId, AgentProviderId, AppSetupState, AvatarHue, DesktopPlatform } from "@openbot/contracts/ipc";
import { ArrowUp, Button, Plus } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, createUniqueId, For, Match, Show, Switch, untrack } from "solid-js";
import { ComputerUseSetup } from "../computer-use/ComputerUseSetup";
import { createSetupProviders, SetupProviderPicker, type SetupProviderProps } from "./SetupProviderPicker";
import { createSetupNext } from "./setup-next";

export interface OnboardingFlowProps extends SetupProviderProps {
  state: AppSetupState;
  platform: DesktopPlatform;
  /**
   * Records the choice. The model is `null` for a built-in provider, which keeps its own default, and
   * names the endpoint the user just described when they chose their own.
   */
  onSave: (provider: AgentProviderId, model: AgentModelId | null) => Promise<void>;
  /** Runs when the provider step is shown. First run scans once, so the host ignores a repeat. */
  onProviderStepShown?: () => void;
}

type OnboardingStep = "meet" | "computer" | "jobs";
type StepDirection = "forward" | "back";

const ONBOARDING_AVATAR_HUES: readonly AvatarHue[] = [0, 30, 55, 100, 150, 185, 215, 245, 280, 320];

type OnboardingAvatarVariant = {
  seed: string;
  hue: AvatarHue;
  cycleOffset: number;
  animationOffset: number;
};

type OnboardingAvatarVariants = {
  meet: OnboardingAvatarVariant;
  computer: OnboardingAvatarVariant;
  inbox: OnboardingAvatarVariant;
  weekly: OnboardingAvatarVariant;
  research: OnboardingAvatarVariant;
};

export function OnboardingFlow(props: OnboardingFlowProps) {
  const { t, errorMessage } = useText();
  const [step, setStep] = createSignal<OnboardingStep>("meet");
  const [direction, setDirection] = createSignal<StepDirection>("forward");
  /**
   * The first-run screen sits on the dialog layer, so a row menu portalled to `body` would paint
   * behind it. Menus mount here instead.
   */
  const [screenElement, setScreenElement] = createSignal<HTMLElement | undefined>();
  const [saving, setSaving] = createSignal(false);
  const providers = createSetupProviders(props);
  createEffect(
    () => step() === "meet",
    (shown) => {
      if (shown) untrack(() => props.onProviderStepShown?.());
    },
  );
  const avatarVariants = createOnboardingAvatarVariants();

  const showsProviderSetup = () =>
    Boolean(
      props.onConnectProvider ||
        props.onDownloadProvider ||
        props.onCancelProviderDownload ||
        props.onInstallProvider ||
        props.onSignInProvider ||
        props.onRefreshProviders,
    );
  const lazyProviderMode = () => Boolean(props.providerRuntimeStatuses || props.onDownloadProvider);
  const nextReasonId = createUniqueId();
  const next = createSetupNext(providers);
  const nextBlockedReason = next.blockedReason;

  function moveTo(nextStep: OnboardingStep, nextDirection: StepDirection): void {
    providers.clearErrors();
    setDirection(nextDirection);
    setStep(nextStep);
  }

  function nextStep(): void {
    if (!providers.selectedProviderConnected()) {
      next.connectSelected();
      return;
    }
    if (step() === "meet") {
      startFreeProvider();
      moveTo("computer", "forward");
      return;
    }
    if (step() === "computer") {
      moveTo("jobs", "forward");
      return;
    }
    void finish();
  }

  /**
   * Starts a free provider the user continued with before it was started. It needs no sign-in, so
   * the connection only asks the CLI for its models, and the next steps give it time to answer.
   */
  function startFreeProvider(): void {
    const option = providers.options().find((candidate) => candidate.id === providers.selectedProvider());
    if (option?.freeModels && option.state !== "available" && option.connectionState !== "connecting") {
      void providers.connectProvider(option.id);
    }
  }

  function previousStep(): void {
    if (step() === "computer") moveTo("meet", "back");
    else if (step() === "jobs") moveTo("computer", "back");
  }

  async function finish(): Promise<void> {
    const provider = providers.selectedProvider();
    if (!provider || !providers.selectedProviderConnected() || saving()) return;
    setSaving(true);
    providers.setError("");
    try {
      // A built-in provider keeps its own default model, so only the custom row sends one.
      await props.onSave(provider, providers.customSelected() ? providers.customModel() : null);
    } catch (cause) {
      providers.setError(errorMessage(cause, t("onboarding.error.finish")));
      setSaving(false);
    }
  }

  const stepNumber = () => (step() === "meet" ? 1 : step() === "computer" ? 2 : 3);

  return (
    <main
      class="onboarding-screen"
      data-step={step()}
      data-direction={direction()}
      ref={(element) => setScreenElement(element)}
    >
      <div class="onboarding-shell">
        <nav class="onboarding-progress" aria-label={t("onboarding.progress", { step: stepNumber(), total: 3 })}>
          <For each={[1, 2, 3]}>
            {(item) => <span class={item === stepNumber() ? "is-active" : item < stepNumber() ? "is-complete" : ""} />}
          </For>
        </nav>

        <div class="onboarding-step" data-step={step()} data-direction={direction()}>
          <Switch>
            <Match when={step() === "meet"}>
              <section class="onboarding-panel onboarding-panel-meet" aria-labelledby="onboarding-title">
                <div class="onboarding-hero-avatar">
                  <AgentAvatar
                    seed={avatarVariants.meet.seed}
                    hue={avatarVariants.meet.hue}
                    motion="idle"
                    cycleOffset={avatarVariants.meet.cycleOffset}
                    animationOffset={avatarVariants.meet.animationOffset}
                    class="onboarding-avatar-hero"
                  />
                </div>
                <h1 id="onboarding-title">{t("onboarding.meet.title")}</h1>
                <p class="onboarding-description">{t("onboarding.meet.description")}</p>

                <section class="composer onboarding-composer" data-compact aria-label={t("onboarding.meet.example")}>
                  <div class="composer-input-label">
                    <div class="composer-editor-root">
                      <span class="composer-editor-placeholder">{t("onboarding.meet.placeholder")}</span>
                    </div>
                  </div>
                  <div class="composer-toolbar">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      class="composer-button"
                      aria-label={t("onboarding.meet.addToPrompt")}
                      disabled
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                    <div class="composer-primary-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        class="voice-button"
                        aria-label={t("onboarding.meet.sendMessage")}
                        disabled
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </section>

                <div class="onboarding-provider">
                  <SetupProviderPicker
                    providers={providers}
                    ariaLabel={t("onboarding.provider.defaultLabel")}
                    label={t("onboarding.provider.label")}
                    hint={
                      lazyProviderMode()
                        ? t("onboarding.provider.hintDownload")
                        : showsProviderSetup()
                          ? t("onboarding.provider.hintConnect")
                          : t("onboarding.provider.hintChange")
                    }
                    disabled={saving()}
                    menuMount={screenElement()}
                  />
                </div>
              </section>
            </Match>

            <Match when={step() === "computer"}>
              <section class="onboarding-panel onboarding-panel-computer" aria-labelledby="onboarding-title">
                <h1 id="onboarding-title">{t("onboarding.computer.title")}</h1>

                <div class="onboarding-computer-visual" aria-hidden="true">
                  <svg viewBox="0 0 400 240" role="presentation">
                    <defs>
                      <linearGradient id="onboarding-computer-desktop-gradient" x1="0" y1="0" x2="1" y2="1">
                        <stop class="onboarding-computer-stop-mist" offset="0" />
                        <stop class="onboarding-computer-stop-blue" offset="0.56" />
                        <stop class="onboarding-computer-stop-indigo" offset="1" />
                      </linearGradient>
                      <radialGradient id="onboarding-computer-desktop-highlight" cx="0.18" cy="0.12" r="0.9">
                        <stop class="onboarding-computer-highlight-start" offset="0" />
                        <stop class="onboarding-computer-highlight-end" offset="1" />
                      </radialGradient>
                    </defs>
                    <rect
                      class="onboarding-computer-desktop"
                      x="12"
                      y="12"
                      width="376"
                      height="216"
                      rx="24"
                      fill="url(#onboarding-computer-desktop-gradient)"
                    />
                    <rect
                      class="onboarding-computer-desktop-highlight"
                      x="12"
                      y="12"
                      width="376"
                      height="216"
                      rx="24"
                      fill="url(#onboarding-computer-desktop-highlight)"
                    />
                    <path class="onboarding-computer-desktop-beam" d="M214 12h92l-78 216H112z" />
                    <g class="onboarding-computer-window">
                      <rect class="onboarding-computer-window-shadow" x="80" y="59" width="256" height="146" rx="14" />
                      <rect class="onboarding-computer-window-body" x="72" y="48" width="256" height="146" rx="14" />
                      <rect class="onboarding-computer-window-bar" x="72" y="48" width="256" height="30" rx="14" />
                      <rect class="onboarding-computer-window-bar-fill" x="72" y="63" width="256" height="15" />
                      <circle class="onboarding-computer-dot onboarding-computer-dot-danger" cx="91" cy="63" r="4" />
                      <circle class="onboarding-computer-dot onboarding-computer-dot-warning" cx="104" cy="63" r="4" />
                      <circle class="onboarding-computer-dot onboarding-computer-dot-success" cx="117" cy="63" r="4" />
                      <rect class="onboarding-computer-window-pane" x="90" y="94" width="64" height="78" rx="8" />
                      <rect class="onboarding-computer-window-card" x="170" y="94" width="138" height="14" rx="7" />
                      <rect class="onboarding-computer-window-line" x="170" y="122" width="108" height="7" rx="3.5" />
                      <rect
                        class="onboarding-computer-window-line onboarding-computer-window-line-short"
                        x="170"
                        y="139"
                        width="78"
                        height="7"
                        rx="3.5"
                      />
                      <rect class="onboarding-computer-window-card" x="170" y="161" width="118" height="10" rx="5" />
                    </g>
                    <g class="onboarding-computer-cursor">
                      <path d="M1.5 1.5v24.8l6.7-6.1 5.5 12.6 5.7-2.5-5.5-12.4h9.6z" />
                    </g>
                  </svg>
                  <div class="onboarding-computer-avatar">
                    <AgentAvatar
                      seed={avatarVariants.computer.seed}
                      hue={avatarVariants.computer.hue}
                      motion="idle"
                      animationOffset={avatarVariants.computer.animationOffset}
                      class="onboarding-computer-avatar-agent"
                    />
                  </div>
                </div>

                <ComputerUseSetup variant="compact" />
              </section>
            </Match>

            <Match when={step() === "jobs"}>
              <section class="onboarding-panel onboarding-panel-jobs" aria-labelledby="onboarding-title">
                <h1 id="onboarding-title">{t("onboarding.jobs.title")}</h1>
                <p class="onboarding-description">{t("onboarding.jobs.description")}</p>

                <section class="onboarding-job-orbit" aria-label={t("onboarding.jobs.example")}>
                  <article class="onboarding-job-card onboarding-job-card-top">
                    <AgentAvatar
                      seed={avatarVariants.inbox.seed}
                      hue={avatarVariants.inbox.hue}
                      motion="always"
                      cycleOffset={avatarVariants.inbox.cycleOffset}
                      animationOffset={avatarVariants.inbox.animationOffset}
                      class="onboarding-job-avatar"
                    />
                    <span>{t("onboarding.jobs.inbox")}</span>
                  </article>
                  <article class="onboarding-job-card onboarding-job-card-left">
                    <AgentAvatar
                      seed={avatarVariants.weekly.seed}
                      hue={avatarVariants.weekly.hue}
                      motion="always"
                      cycleOffset={avatarVariants.weekly.cycleOffset}
                      animationOffset={avatarVariants.weekly.animationOffset}
                      class="onboarding-job-avatar"
                    />
                    <span>{t("onboarding.jobs.weekly")}</span>
                  </article>
                  <article class="onboarding-job-card onboarding-job-card-right">
                    <AgentAvatar
                      seed={avatarVariants.research.seed}
                      hue={avatarVariants.research.hue}
                      motion="always"
                      cycleOffset={avatarVariants.research.cycleOffset}
                      animationOffset={avatarVariants.research.animationOffset}
                      class="onboarding-job-avatar"
                    />
                    <span>{t("onboarding.jobs.research")}</span>
                  </article>
                </section>
              </section>
            </Match>
          </Switch>
        </div>

        <Show when={providers.error()}>
          <p class="onboarding-error" role="alert">
            {providers.error()}
          </p>
        </Show>

        <div class="onboarding-actions">
          <Show when={step() !== "meet"}>
            <Button type="button" variant="outline" class="onboarding-back" disabled={saving()} onClick={previousStep}>
              {t("common.back")}
            </Button>
          </Show>
          <Button
            type="button"
            variant="default"
            class="onboarding-next"
            disabled={saving()}
            aria-describedby={nextBlockedReason() ? nextReasonId : undefined}
            loading={saving()}
            loadingLabel={t("onboarding.opening")}
            onClick={nextStep}
          >
            {!providers.selectedProviderConnected()
              ? t("onboarding.action.connect")
              : step() === "jobs"
                ? t("onboarding.action.open")
                : t("onboarding.action.next")}
          </Button>
          {/* Named by the button above, so the reason is read out with it rather than hunted for. */}
          <Show when={nextBlockedReason()}>
            {(reason) => (
              <p class="onboarding-next-reason" id={nextReasonId}>
                {reason()}
              </p>
            )}
          </Show>
        </div>
      </div>
    </main>
  );
}

function createOnboardingAvatarVariants(): OnboardingAvatarVariants {
  const sessionSeed = `onboarding-${randomUnit().toString(36)}-${Date.now().toString(36)}`;
  const createVariant = (slot: string): OnboardingAvatarVariant => ({
    seed: `${sessionSeed}:${slot}:${randomUnit().toString(36)}`,
    hue: randomItem(ONBOARDING_AVATAR_HUES),
    cycleOffset: randomInt(12),
    animationOffset: randomUnit() * 2.4,
  });

  return {
    meet: createVariant("meet"),
    computer: createVariant("computer"),
    inbox: createVariant("inbox"),
    weekly: createVariant("weekly"),
    research: createVariant("research"),
  };
}

function randomItem<T>(items: readonly T[]): T {
  const item = items[randomInt(items.length)];
  if (item === undefined) throw new Error("The onboarding avatar list is empty.");
  return item;
}

function randomInt(maxExclusive: number): number {
  return Math.floor(randomUnit() * maxExclusive);
}

function randomUnit(): number {
  try {
    const values = new Uint32Array(1);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(values);
      return (values[0] ?? 0) / 0x1_0000_0000;
    }
  } catch {
    // Fall back to the browser's pseudo-random source when secure random values are unavailable.
  }
  return Math.random();
}
