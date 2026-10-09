import type { AppLogoVariant } from "@openbot/brand";
import type { AgentModelId, AgentProviderId, AppSetupState, DesktopPlatform } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, createStore, createUniqueId, For, Match, Show, Switch, untrack } from "solid-js";
import { ComputerUseSetup } from "../computer-use/ComputerUseSetup";
import { FirstRunChoice } from "./FirstRunChoice";
import { FirstRunLaunch } from "./FirstRunLaunch";
import { FirstRunPlanStep } from "./FirstRunPlanStep";
import { firstRunTransition } from "./first-run-transition";
import { OnboardingComputerVisual } from "./OnboardingComputerVisual";
import { createOnboardingAvatarVariant, createOnboardingTeam, onboardingSessionSeed } from "./onboarding-avatars";
import { FREE_PROVIDER } from "./onboarding-provider-rows";
import { createSetupProviders, type SetupProviderProps } from "./SetupProviderPicker";
import { createSetupNext } from "./setup-next";

export interface FirstRunFlowProps extends SetupProviderProps {
  state: AppSetupState;
  platform: DesktopPlatform;
  /**
   * Records the choice. The model is `null` for a built-in provider, which keeps its own default, and
   * names the endpoint the user just described when they chose their own.
   */
  onSave: (provider: AgentProviderId, model: AgentModelId | null) => Promise<void>;
  /** Runs when the provider step is shown. First run scans once, so the host ignores a repeat. */
  onProviderStepShown?: () => void;
  /** The logo colour of this build, for the splash that shows while the app opens. */
  logoVariant?: AppLogoVariant;
}

const TEAM_SIZE = 7;

type FirstRunStep = "choose" | "plan" | "computer";
/** How the user starts: on free models, or on a plan they connect. `null` until they choose. */
type FirstRunPath = "free" | "plan" | null;

interface FirstRunState {
  step: FirstRunStep;
  path: FirstRunPath;
  saving: boolean;
  /** The user asked to open OpenBot before the provider was ready, so setup ends when it is. */
  finishWhenReady: boolean;
}

/**
 * First run with one question first: start free, or connect a plan. The free path needs no
 * sign-in. Its provider downloads from the moment first run opens, so it is often ready when the
 * user chooses. Only macOS asks for the Computer Use permissions; other systems have none.
 */
export function FirstRunFlow(props: FirstRunFlowProps) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<FirstRunState>({
    step: "choose",
    path: null,
    saving: false,
    finishWhenReady: false,
  });
  /**
   * The first-run screen sits on the dialog layer, so a row menu portalled to `body` would paint
   * behind it. Menus mount here instead.
   */
  const [screenElement, setScreenElement] = createSignal<HTMLElement | undefined>();
  const providers = createSetupProviders(props, undefined, { includeFree: () => state.path !== "plan" });
  const next = createSetupNext(providers);
  const nextReasonId = createUniqueId();
  const computerAvatar = createOnboardingAvatarVariant(onboardingSessionSeed(), "computer");
  // The first screen and the splash show the same team, so the agents that greet the user also jump
  // while the app opens.
  const team = createOnboardingTeam(onboardingSessionSeed(), TEAM_SIZE);
  /** The free provider downloads once on its own. A failed download waits for the user. */
  let freeDownloadRequested = false;
  /** The free provider is started once on its own. A failed start waits for the user. */
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

  // Most users start free, so its download starts before they choose. It waits until the status says
  // there is no OpenCode CLI: a user with their own gets no download. It goes to the host directly,
  // because the row action would also choose the provider and fix the plan rows before the user saw
  // them. A failed request leaves the provider not downloaded; "Start free" tries again and says why.
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

  // The free provider starts when its runtime is on disk. The first connection only asks the CLI
  // for its models, and the permission step gives it time to answer. A provider refresh ignores a
  // connection, so the start waits for it to end.
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

  // Open waits for the provider; a failed download or start stops the wait, and the reason says why.
  // A request that fails before either begins stops it in `stopWaitUnlessSent`.
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

  function moveTo(step: FirstRunStep): void {
    providers.clearErrors();
    void firstRunTransition("step", () => {
      setState((current) => {
        current.step = step;
      });
    });
  }

  // A write shows in reads only after the next flush, so this reads no state that it writes.
  function startFree(): void {
    providers.chooseProvider(FREE_PROVIDER);
    setState((current) => {
      current.path = "free";
    });
    retryFree();
    // The step after the first question; the plan step's "Start free instead" also lands there.
    const following = stepsFor("free")[1];
    if (following) {
      moveTo(following);
      return;
    }
    // With no other step, the first question is where the user waits for the free provider. The
    // wait opens the app when it is ready, at once if it is ready now.
    if (state.step !== "choose") moveTo("choose");
    setState((current) => {
      current.finishWhenReady = true;
    });
  }

  function usePlan(): void {
    if (providers.selectedProvider() === FREE_PROVIDER && !providers.customSelected()) providers.clearChoice();
    setState((current) => {
      current.path = "plan";
    });
    moveTo("plan");
  }

  /** Only the plan step and Open wait for the provider: the free path continues while it starts. */
  function nextStep(): void {
    const following = steps()[stepNumber()];
    if (!following) openWhenReady();
    else if (state.step === "plan" && !providers.selectedProviderConnected()) next.connectSelected();
    else moveTo(following);
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

  /** Downloads the free provider again, or starts it again, after it failed. */
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

  /** A rejected request changes no provider status, so the wait for the provider stops here. */
  function stopWaitUnlessSent(sent: boolean): void {
    if (sent) return;
    setState((current) => {
      current.finishWhenReady = false;
    });
  }

  function previousStep(): void {
    const previous = steps()[stepNumber() - 2];
    if (previous) moveTo(previous);
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
      // A built-in provider keeps its own default model, so only the custom row sends one.
      await props.onSave(provider, providers.customSelected() ? providers.customModel() : null);
    } catch (cause) {
      providers.setError(errorMessage(cause, t("onboarding.error.finish")));
      setState((current) => {
        current.saving = false;
      });
    }
  }

  const busy = () => state.saving || state.finishWhenReady;
  /** While first run waits to open the app, the splash covers the steps. It comes and goes in a transition. */
  const [launchShown, setLaunchShown] = createSignal(false);
  createEffect(busy, (waiting) => {
    if (waiting === launchShown()) return;
    // The update runs a frame later. Saving can fail before it, so it reads the state it applies then.
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
    if (state.step === "plan" && !providers.selectedProviderConnected()) return t("onboarding.action.connect");
    return t("onboarding.action.next");
  };
  /**
   * The reason shows only where the user waits for the provider. The free path does not wait on
   * the permission step, and the first question waits only when it is also the last step.
   */
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

          <div class="onboarding-step" data-step={state.step}>
            <Switch>
              <Match when={state.step === "choose"}>
                <FirstRunChoice
                  team={team}
                  disabled={busy()}
                  loading={busy()}
                  reason={blockedReason()}
                  onStartFree={startFree}
                  onUsePlan={usePlan}
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
                disabled={busy()}
                aria-describedby={blockedReason() ? nextReasonId : undefined}
                loading={busy()}
                loadingLabel={t("onboarding.opening")}
                onClick={nextStep}
              >
                {mainLabel()}
              </Button>
              {/* Named by the button above, so the reason is read out with it rather than hunted for. */}
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
