import type { AppLogoVariant } from "@openbot/brand";
import type { AgentModelId, AgentProviderId, AppSetupState, DesktopPlatform } from "@openbot/contracts/ipc";
import { Button, ErrorReference } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, createStore, createUniqueId, For, Match, Show, Switch, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { ComputerUseSetup } from "../computer-use/ComputerUseSetup";
import { FirstRunChoice } from "./FirstRunChoice";
import { FirstRunExistingServers, type FirstRunServer } from "./FirstRunExistingServers";
import { FirstRunLaunch } from "./FirstRunLaunch";
import { FirstRunPlanStep } from "./FirstRunPlanStep";
import { firstRunTransition } from "./first-run-transition";
import { OnboardingComputerVisual } from "./OnboardingComputerVisual";
import { createOnboardingAvatarVariant, createOnboardingTeam, onboardingSessionSeed } from "./onboarding-avatars";
import type { OnboardingJourney } from "./onboarding-context";
import { onboardingPort } from "./onboarding-port";
import { FREE_PROVIDER } from "./onboarding-provider-rows";
import { createSetupProviders, type SetupProviderProps } from "./SetupProviderPicker";
import { createSetupNext } from "./setup-next";

export interface FirstRunFlowProps extends SetupProviderProps {
  state: AppSetupState;
  platform: DesktopPlatform;
  onSave: (provider: AgentProviderId, model: AgentModelId | null, journey: OnboardingJourney) => Promise<void>;
  onAnalyticsChoice: (enabled: boolean, chosen: boolean) => void;
  onProviderStepShown?: () => void;
  logoVariant?: AppLogoVariant;
  existingServers?: readonly FirstRunServer[];
  onOpenServer?: (serverId: string, provider: AgentProviderId) => Promise<boolean>;
}

const TEAM_SIZE = 7;
const TERMS_URL = "https://openbot.run/terms";
const PRIVACY_URL = "https://openbot.run/privacy";

type FirstRunStep = "choose" | "plan" | "computer";
type FirstRunPath = "free" | "plan" | null;

interface FirstRunState {
  step: FirstRunStep;
  path: FirstRunPath;
  saving: boolean;
  finishWhenReady: boolean;
  skipped: boolean;
  analytics: boolean;
  analyticsTouched: boolean;
  startNew: boolean;
  openingServer: string | null;
}

export function FirstRunFlow(props: FirstRunFlowProps) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<FirstRunState>({
    step: "choose",
    path: null,
    saving: false,
    finishWhenReady: false,
    skipped: false,
    analytics: false,
    analyticsTouched: false,
    startNew: false,
    openingServer: null,
  });
  void onboardingPort()
    .getAnalyticsDefault()
    .then(({ enabled }) =>
      setState((current) => {
        if (!current.analyticsTouched) current.analytics = enabled;
      }),
    )
    .catch(() => undefined);
  const [screenElement, setScreenElement] = createSignal<HTMLElement | undefined>();
  const providers = createSetupProviders(props, undefined, { includeFree: () => state.path !== "plan" });
  const next = createSetupNext(providers);
  const nextReasonId = createUniqueId();
  const computerAvatar = createOnboardingAvatarVariant(onboardingSessionSeed(), "computer");
  const team = createOnboardingTeam(onboardingSessionSeed(), TEAM_SIZE);
  let freeDownloadRequested = false;
  let freeStartRequested = false;

  const stepsFor = (path: FirstRunPath): FirstRunStep[] => {
    const permissions: FirstRunStep[] = props.platform === "darwin" ? ["computer"] : [];
    return path === "plan" ? ["choose", "plan", ...permissions] : ["choose", ...permissions];
  };
  const steps = () => stepsFor(state.path);
  const stepNumber = () => steps().indexOf(state.step) + 1;
  const lastStep = () => stepNumber() === steps().length;
  const option = (provider: AgentProviderId | null) =>
    providers.options().find((candidate) => candidate.id === provider);

  createEffect(
    () => state.step === "plan",
    (shown) => {
      if (shown) untrack(() => props.onProviderStepShown?.());
    },
  );

  createEffect(
    () => {
      const free = option(FREE_PROVIDER);
      return free?.state === "not-installed" && free.runtimeStatus?.phase === "not-downloaded";
    },
    (missing) => {
      if (!missing || freeDownloadRequested) return;
      freeDownloadRequested = true;
      untrack(() => void Promise.resolve(props.onDownloadProvider?.(FREE_PROVIDER)).catch(() => undefined));
    },
  );

  createEffect(
    () => {
      const free = state.path === "free" ? option(FREE_PROVIDER) : undefined;
      return Boolean(
        free &&
          !props.refreshingProviders &&
          (free.runtimeStatus?.phase ?? "ready") === "ready" &&
          free.state !== "available" &&
          free.connectionState !== "connecting",
      );
    },
    (startable) => {
      if (!startable || freeStartRequested) return;
      freeStartRequested = true;
      untrack(() => void providers.connectProvider(FREE_PROVIDER).then(stopWaitUnlessSent));
    },
  );

  createEffect(
    () => ({
      waiting: state.finishWhenReady,
      ready: providers.selectedProviderConnected(),
      failed:
        option(providers.selectedProvider())?.runtimeStatus?.phase === "download-error" ||
        option(providers.selectedProvider())?.state === "error",
    }),
    ({ waiting, ready, failed }) => {
      if (!waiting) return;
      if (ready) untrack(() => void finish());
      else if (failed)
        setState((current) => {
          current.finishWhenReady = false;
        });
    },
  );

  const existingShown = () =>
    state.step === "choose" &&
    !state.startNew &&
    state.path === null &&
    !state.analyticsTouched &&
    (props.existingServers?.length ?? 0) > 0;
  const shownStep = () => (existingShown() ? "existing" : state.step);

  function trackStep(
    action: "viewed" | "next" | "back" | "skipped",
    path: FirstRunPath | "existing" = state.path,
  ): void {
    desktopAnalytics.track("onboarding_step", { step: shownStep(), action, ...(path ? { path } : {}) });
  }
  createEffect(shownStep, () => untrack(() => trackStep("viewed")));

  function moveTo(step: FirstRunStep): void {
    providers.clearErrors();
    void firstRunTransition("step", () => {
      setState((current) => {
        current.step = step;
      });
    });
  }

  function startFree(): void {
    const fromPlan = state.step === "plan";
    if (!fromPlan) props.onAnalyticsChoice(state.analytics, state.analyticsTouched);
    trackStep(fromPlan ? "skipped" : "next", "free");
    providers.chooseProvider(FREE_PROVIDER);
    setState((current) => {
      current.path = "free";
      if (fromPlan) current.skipped = true;
    });
    retryFree();
    const following = stepsFor("free")[1];
    if (following) {
      moveTo(following);
      return;
    }
    if (state.step !== "choose") moveTo("choose");
    setState((current) => {
      current.finishWhenReady = true;
    });
  }

  function usePlan(): void {
    if (providers.selectedProvider() === FREE_PROVIDER && !providers.customSelected()) providers.clearChoice();
    props.onAnalyticsChoice(state.analytics, state.analyticsTouched);
    trackStep("next", "plan");
    setState((current) => {
      current.path = "plan";
    });
    moveTo("plan");
  }

  function nextStep(): void {
    const following = steps()[stepNumber()];
    if (following && state.step === "plan" && !providers.selectedProviderConnected()) {
      next.connectSelected();
      return;
    }
    trackStep("next");
    if (following) moveTo(following);
    else openWhenReady();
  }

  function openWhenReady(): void {
    if (providers.selectedProviderConnected()) {
      void finish();
      return;
    }
    if (state.path !== "free") {
      next.connectSelected();
      return;
    }
    retryFree();
    setState((current) => {
      current.finishWhenReady = true;
    });
  }

  function retryFree(): void {
    const free = option(FREE_PROVIDER);
    const phase = free?.runtimeStatus?.phase;
    if (phase === "not-downloaded" || phase === "download-error") {
      freeDownloadRequested = true;
      void providers.downloadProvider(FREE_PROVIDER).then(stopWaitUnlessSent);
      return;
    }
    if (free?.state === "error") {
      freeStartRequested = true;
      void providers.connectProvider(FREE_PROVIDER).then(stopWaitUnlessSent);
    }
  }

  function stopWaitUnlessSent(sent: boolean): void {
    if (sent) return;
    setState((current) => {
      current.finishWhenReady = false;
    });
  }

  async function openServer(server: FirstRunServer): Promise<void> {
    if (state.openingServer !== null || !props.onOpenServer) return;
    props.onAnalyticsChoice(state.analytics, state.analyticsTouched);
    trackStep("next", "existing");
    setState((current) => {
      current.openingServer = server.id;
    });
    providers.setError("");
    const failed = t("onboarding.existing.openFailed", { name: server.name });
    try {
      if (await props.onOpenServer(server.id, FREE_PROVIDER)) return;
      providers.setError(failed);
    } catch (cause) {
      providers.setError(errorMessage(cause, failed), cause);
    }
    setState((current) => {
      current.openingServer = null;
    });
  }

  function startNew(): void {
    trackStep("skipped");
    providers.clearErrors();
    void firstRunTransition("step", () => {
      setState((current) => {
        current.startNew = true;
      });
    });
  }

  function previousStep(): void {
    const previous = steps()[stepNumber() - 2];
    if (!previous) return;
    trackStep("back");
    moveTo(previous);
  }

  async function finish(): Promise<void> {
    const provider = providers.selectedProvider();
    if (!provider || !providers.selectedProviderConnected() || state.saving) return;
    setState((current) => {
      current.saving = true;
      current.finishWhenReady = false;
    });
    providers.setError("");
    try {
      await props.onSave(provider, providers.customSelected() ? providers.customModel() : null, {
        ...(state.path ? { path: state.path } : {}),
        skipped: state.skipped,
      });
    } catch (cause) {
      providers.setError(errorMessage(cause, t("onboarding.error.finish")), cause);
      setState((current) => {
        current.saving = false;
      });
    }
  }

  const busy = () => state.saving || state.finishWhenReady;
  const [launchShown, setLaunchShown] = createSignal(false);
  createEffect(busy, (waiting) => {
    if (waiting === launchShown()) return;
    void firstRunTransition("open", () => {
      setLaunchShown(busy());
    });
  });
  const stepsShown = () => !launchShown();
  const freeStatus = () => (state.path === "free" ? option(FREE_PROVIDER)?.runtimeStatus : undefined);
  const logoVariant = () => props.logoVariant ?? "production";
  const freeDownloading = () => freeStatus()?.phase === "downloading";
  const freeProgress = () => freeStatus()?.progress ?? null;
  const mainLabel = () => {
    if (lastStep()) return t("onboarding.action.open");
    if (state.step === "plan" && !providers.selectedProviderConnected()) {
      const phase = option(providers.selectedProvider())?.runtimeStatus?.phase;
      return phase === "not-downloaded" || phase === "download-error"
        ? t("common.download")
        : t("onboarding.action.connect");
    }
    return t("onboarding.action.next");
  };
  const blockedReason = () => {
    if (state.step === "choose" ? state.path !== "free" || !lastStep() : state.path === "free" && !lastStep()) {
      return "";
    }
    return next.blockedReason();
  };

  return (
    <main
      class="onboarding-screen first-run-screen"
      data-step={state.step}
      ref={(element) => setScreenElement(element)}
    >
      <Show
        when={stepsShown()}
        fallback={
          <FirstRunLaunch
            team={team}
            variant={logoVariant()}
            downloading={freeDownloading()}
            progress={freeProgress()}
          />
        }
      >
        <div class="onboarding-shell">
          <Show when={state.step !== "choose"}>
            <nav
              class="onboarding-progress"
              aria-label={t("onboarding.progress", { step: stepNumber(), total: steps().length })}
            >
              <For each={steps()}>
                {(_item, index) => (
                  <span
                    class={index() + 1 === stepNumber() ? "is-active" : index() + 1 < stepNumber() ? "is-complete" : ""}
                  />
                )}
              </For>
            </nav>
          </Show>

          <div class="onboarding-step" data-step={shownStep()}>
            <Switch>
              <Match when={existingShown()}>
                <FirstRunExistingServers
                  servers={props.existingServers ?? []}
                  opening={state.openingServer}
                  disabled={busy()}
                  onOpen={(server) => void openServer(server)}
                  onStartNew={startNew}
                  onOpenTerms={() => void onboardingPort().openUrl(TERMS_URL)}
                  onOpenPrivacy={() => void onboardingPort().openUrl(PRIVACY_URL)}
                />
              </Match>

              <Match when={state.step === "choose"}>
                <FirstRunChoice
                  team={team}
                  disabled={busy()}
                  loading={busy()}
                  reason={blockedReason()}
                  onStartFree={startFree}
                  onUsePlan={usePlan}
                  analytics={state.analytics}
                  onAnalyticsChange={(enabled) =>
                    setState((current) => {
                      current.analytics = enabled;
                      current.analyticsTouched = true;
                    })
                  }
                  onOpenTerms={() => void onboardingPort().openUrl(TERMS_URL)}
                  onOpenPrivacy={() => void onboardingPort().openUrl(PRIVACY_URL)}
                />
              </Match>

              <Match when={state.step === "plan"}>
                <FirstRunPlanStep providers={providers} disabled={busy()} menuMount={screenElement()} />
              </Match>

              <Match when={state.step === "computer"}>
                <section class="onboarding-panel onboarding-panel-computer" aria-labelledby="onboarding-title">
                  <h1 id="onboarding-title">{t("onboarding.computer.title")}</h1>
                  <OnboardingComputerVisual avatar={computerAvatar} />
                  <ComputerUseSetup variant="compact" />
                </section>
              </Match>
            </Switch>
          </div>

          <Show when={providers.error()}>
            <p class="onboarding-error" role="alert">
              {providers.error()}
              <ErrorReference reference={providers.errorReference()} />
            </p>
          </Show>

          <Show when={state.step !== "choose"}>
            <div class="onboarding-actions">
              <Button type="button" variant="outline" class="onboarding-back" disabled={busy()} onClick={previousStep}>
                {t("common.back")}
              </Button>
              <Button
                type="button"
                variant="default"
                class="onboarding-next"
                aria-describedby={blockedReason() ? nextReasonId : undefined}
                loading={busy()}
                loadingLabel={t("onboarding.opening")}
                onClick={nextStep}
              >
                {mainLabel()}
              </Button>
              <Show when={blockedReason()}>
                {(reason) => (
                  <p class="onboarding-next-reason" id={nextReasonId}>
                    {reason()}
                  </p>
                )}
              </Show>
              <Show when={state.step === "plan"}>
                <Button type="button" variant="ghost" disabled={busy()} onClick={startFree}>
                  {t("onboarding.choice.startFreeInstead")}
                </Button>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </main>
  );
}
