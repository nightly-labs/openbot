import type { AgentModelId, AgentProviderId, AppSetupState } from "@openbot/contracts/ipc";
import { errorReference } from "@openbot/user-errors";
import { createSignal, createStore, onSettled } from "solid-js";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";
import { createSimpleContext } from "../../simple-context";
import { firstRunTransition } from "./first-run-transition";
import { onboardingPort } from "./onboarding-port";

/** How first run went: the path the user took, and whether they skipped a step. */
export type OnboardingJourney = Pick<DesktopAnalyticsProperties<"onboarding_completed">, "path" | "skipped">;

/** The first read of the saved setup. */
interface SetupRead {
  /** The read has ended, with a state or with a failure. */
  loaded: boolean;
  /** The last read failed, so the saved setup is unknown rather than empty. */
  failed: boolean;
  retrying: boolean;
  /** The support code of the last failure. */
  reference: string | null;
}

/** The saved local default, first-run state, and pending server invitation. */
const Setup = createSimpleContext({
  name: "Setup",
  init: () => {
    const [setupState, setSetupState] = createSignal<AppSetupState | null>(null);
    const [read, setRead] = createStore<SetupRead>({ loaded: false, failed: false, retrying: false, reference: null });
    const [pendingInviteUrl, setPendingInviteUrl] = createSignal("");

    /**
     * A failed read ends the loading screen, but it is not "not configured yet": a brief IPC failure
     * must not send a configured user into first-run setup. The view shows the read error until a
     * retry succeeds or the user chooses to set up again.
     */
    async function readSetupState(): Promise<void> {
      try {
        const state = await onboardingPort().getSetupState();
        setSetupState(state);
        setRead((current) => {
          current.loaded = true;
          current.failed = false;
          current.reference = null;
        });
      } catch (error) {
        setRead((current) => {
          current.loaded = true;
          current.failed = true;
          current.reference = errorReference(error);
        });
      }
    }

    onSettled(() => {
      void readSetupState();
      // A joined owner or admin can change the default provider of this computer from a phone.
      return onboardingPort().onSetupState(setSetupState);
    });

    async function retrySetupRead(): Promise<void> {
      if (read.retrying) return;
      setRead((current) => {
        current.retrying = true;
      });
      await readSetupState();
      setRead((current) => {
        current.retrying = false;
      });
    }

    /** Leaves the read error for first-run setup with no saved state, as before the read error existed. */
    function setUpAgain(): void {
      setRead((current) => {
        current.failed = false;
        current.reference = null;
      });
    }

    /**
     * The model a save keeps when the caller names none. Provider settings and the join-a-server flow
     * choose a provider alone, and a model belongs to the provider that serves it, so the saved
     * model survives only while the provider is unchanged.
     */
    function keptModel(preferredProvider: AgentProviderId): AgentModelId | null {
      const previous = setupState();
      if (!previous || previous.preferredProvider !== preferredProvider) return null;
      return previous.preferredModel ?? null;
    }

    /**
     * An omitted model keeps the current provider's model; null clears it. `journey` tells analytics
     * how first run went.
     */
    async function saveSetup(
      preferredProvider: AgentProviderId,
      preferredModel?: AgentModelId | null,
      journey: OnboardingJourney = {},
    ) {
      const wasCompleted = setupState()?.completed === true;
      const analytics = desktopAnalytics.scope();
      const state = await onboardingPort().saveSetup({
        preferredProvider,
        preferredModel: preferredModel === undefined ? keptModel(preferredProvider) : preferredModel,
      });
      // Only the first completion is onboarding; later saves are a review. It opens the app, so the
      // setup screen fades into it.
      if (!wasCompleted && state.completed) {
        await firstRunTransition("open", () => {
          setSetupState(state);
        });
        analytics.track("onboarding_completed", { preferred_provider: preferredProvider, ...journey });
      } else {
        setSetupState(state);
      }
    }

    async function previewInvite(input: { inviteUrl: string }) {
      return onboardingPort().servers.previewInvite(input);
    }

    return {
      setupState,
      setupLoaded: () => read.loaded,
      setupReadFailed: () => read.failed,
      setupReadRetrying: () => read.retrying,
      setupReadReference: () => read.reference,
      retrySetupRead,
      setUpAgain,
      pendingInviteUrl,
      setPendingInviteUrl,
      saveSetup,
      previewInvite,
    };
  },
});

export const SetupProvider = Setup.provider;
export const useSetup = Setup.use;
