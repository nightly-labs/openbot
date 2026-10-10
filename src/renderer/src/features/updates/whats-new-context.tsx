import { summarizeWhatsNew, type WhatsNewNotes, type WhatsNewRelease } from "@openbot/ui/features/updates/whats-new";
import { createEffect, createStore, onSettled } from "solid-js";
import { usePlatform } from "../../platform";
import { createSimpleContext } from "../../simple-context";
import {
  claimWhatsNewVersion,
  compareReleaseVersions,
  readWhatsNewVersion,
  releaseVersion,
  selectWhatsNewReleases,
} from "./whats-new-history";
import { loadWhatsNewReleases } from "./whats-new-releases";

const WhatsNew = createSimpleContext({
  name: "WhatsNew",
  init: (props: { loadReleases?: (signal: AbortSignal) => Promise<readonly WhatsNewRelease[]> }) => {
    const platform = usePlatform();
    // Capture the old analytics value before Settings writes this launch's version.
    const storage = {
      getItem: (key: string) => window.localStorage.getItem(key),
      setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    };
    const previous = readWhatsNewVersion(storage);
    const [state, setState] = createStore<{
      open: boolean;
      version: string;
      previousVersion: string | null;
      notes: WhatsNewNotes;
    }>({ open: false, version: "", previousVersion: null, notes: { status: "loading" } });
    let initialized = false;
    let request = 0;
    let pending: AbortController | undefined;
    onSettled(() => () => {
      request++;
      pending?.abort();
    });

    async function load(automatic: boolean, version: string, from: string | null): Promise<void> {
      const id = ++request;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      setState((draft) => {
        draft.version = version;
        draft.previousVersion = from;
        draft.notes = { status: "loading" };
        if (!automatic) draft.open = true;
      });
      let notes: WhatsNewNotes;
      try {
        const whatsNewReleases = await (props.loadReleases ?? loadWhatsNewReleases)(
          AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        );
        notes = { status: "ready", releases: selectWhatsNewReleases(whatsNewReleases, version, from) };
      } catch {
        notes = { status: "failed" };
      }
      if (id !== request) return;
      // Empty releases are consumed silently. A failure opens once and can be retried in Settings.
      if (automatic && !claimWhatsNewVersion(storage, version)) return;
      const summary = notes.status === "ready" ? summarizeWhatsNew(notes.releases) : null;
      setState((draft) => {
        draft.notes = notes;
        if (automatic) draft.open = summary === null || summary.notices.length > 0 || summary.groups.length > 0;
      });
    }

    createEffect(platform.appInfo, (info) => {
      if (initialized || platform.landingPreview || !platform.appInfoLoadedFromHost()) return;
      const current = releaseVersion(info?.version ?? null);
      if (current === null) return;
      initialized = true;
      if (previous !== null) claimWhatsNewVersion(storage, previous);
      setState((draft) => {
        draft.version = current;
      });
      if (previous === null) {
        claimWhatsNewVersion(storage, current);
      } else if (compareReleaseVersions(current, previous) > 0) {
        // The workspace calls start after login and setup, so notes do not cover onboarding.
        setState((draft) => {
          draft.previousVersion = previous;
        });
      }
    });

    let started = false;
    function start(): void {
      if (started || !state.version) return;
      started = true;
      if (state.previousVersion !== null) void load(true, state.version, state.previousVersion);
    }

    function reopen(): void {
      const version = state.version;
      if (!version) return;
      // Manual opening also consumes a pending automatic display.
      claimWhatsNewVersion(storage, version);
      started = true;
      void load(false, version, null);
    }

    return {
      state,
      start,
      reopen,
      retry: () => {
        void load(false, state.version, state.previousVersion);
      },
      close: () => {
        request++;
        pending?.abort();
        setState((draft) => {
          draft.open = false;
        });
      },
    };
  },
});

export const WhatsNewProvider = WhatsNew.provider;
export const useWhatsNew = WhatsNew.use;
