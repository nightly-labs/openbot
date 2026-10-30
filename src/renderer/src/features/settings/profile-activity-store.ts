import { analyticsRange, type ClientAgentSummary, type HostAnalytics, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import type { ProfileActivityPhase } from "@openbot/ui/features/settings/ProfileActivity";
import type { ProfileActivityState } from "@openbot/ui/features/settings/SettingsProfileTab";
import { errorReference } from "@openbot/user-errors";
import { createEffect, createStore, untrack } from "solid-js";
import { usagePort } from "../usage/usage-port";

/** The past year of this computer's host analytics, the report that the Profile tab summarizes. */
const PROFILE_DAYS = 365;

/**
 * Loads the report each time the Profile tab shows, and again after each turn while it shows. The
 * report on screen stays while a later load runs, so the tiles do not empty and fill again.
 */
export function createProfileActivityStore(
  isActive: () => boolean,
  createShareImage: NonNullable<ProfileActivityState["onCreateShareImage"]>,
): ProfileActivityState {
  const [state, setState] = createStore<{
    phase: ProfileActivityPhase;
    report: HostAnalytics | null;
    agents: ClientAgentSummary[];
    errorReference: string | null;
  }>({ phase: "loading", report: null, agents: [], errorReference: null });
  let generation = 0;

  async function load(): Promise<void> {
    const request = ++generation;
    const background = untrack(() => state.report !== null);
    if (!background)
      setState((draft) => {
        draft.phase = "loading";
        draft.errorReference = null;
      });
    const { startDate, endDate, timeZone } = analyticsRange("profile", PROFILE_DAYS);
    try {
      const [report, agents] = await Promise.all([
        usagePort().agent.getHostAnalytics({ startDate, endDate, timeZone }, LOCAL_SERVER_ID),
        usagePort().agent.listAgents(LOCAL_SERVER_ID),
      ]);
      if (request !== generation) return;
      setState((draft) => {
        draft.report = report;
        draft.agents = agents;
        draft.phase = report ? "ready" : "unsupported";
      });
    } catch (error) {
      // A failed refresh keeps the report on screen; the next turn or the next visit tries again.
      if (request !== generation || background) return;
      setState((draft) => {
        draft.phase = "error";
        draft.errorReference = errorReference(error);
      });
    }
  }

  createEffect(isActive, (active) => {
    if (!active) {
      generation++;
      return;
    }
    void load();
    const unsubscribe = usagePort().agent.onScopedEvent(({ serverId, event }) => {
      if (serverId === LOCAL_SERVER_ID && event.type === "turn-completed") void load();
    });
    return () => {
      unsubscribe();
    };
  });

  return {
    get phase() {
      return state.phase;
    },
    get report() {
      return state.report;
    },
    get agents() {
      return state.agents;
    },
    get errorReference() {
      return state.errorReference;
    },
    onRetry: () => void load(),
    onCreateShareImage: createShareImage,
  };
}
