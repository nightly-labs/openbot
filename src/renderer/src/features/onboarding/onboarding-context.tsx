import type { AgentModelId, AgentProviderId, AppSetupState } from "@openbot/contracts/ipc";
import { createSignal, onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { createSimpleContext } from "../../simple-context";
import { onboardingPort } from "./onboarding-port";

/** The saved local default, first-run state, and pending server invitation. */
const Setup = createSimpleContext({
  name: "Setup",
  init: () => {
    const [setupState, setSetupState] = createSignal<AppSetupState | null>(null);
    const [setupLoaded, setSetupLoaded] = createSignal(false);
    const [pendingInviteUrl, setPendingInviteUrl] = createSignal("");

    onSettled(() => {
      // `finally`, not `then`: a failed read still ends the loading screen, and
      // a null `setupState` is the same "not configured yet" the view handles.
      void onboardingPort()
        .getSetupState()
        .then(setSetupState)
        .finally(() => setSetupLoaded(true));
    });

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

    /** An omitted model keeps the current provider's model; null clears it. */
    async function saveSetup(preferredProvider: AgentProviderId, preferredModel?: AgentModelId | null) {
      const wasCompleted = setupState()?.completed === true;
      const analytics = desktopAnalytics.scope();
      const state = await onboardingPort().saveSetup({
        preferredProvider,
        preferredModel: preferredModel === undefined ? keptModel(preferredProvider) : preferredModel,
      });
      setSetupState(state);
      // Only the first completion is onboarding; later saves are a review.
      if (!wasCompleted && state.completed) {
        analytics.track("onboarding_completed", { preferred_provider: preferredProvider });
      }
    }

    async function previewInvite(input: { inviteUrl: string }) {
      return onboardingPort().servers.previewInvite(input);
    }

    return {
      setupState,
      setupLoaded,
      pendingInviteUrl,
      setPendingInviteUrl,
      saveSetup,
      previewInvite,
    };
  },
});

export const SetupProvider = Setup.provider;
export const useSetup = Setup.use;
