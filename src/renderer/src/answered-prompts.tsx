import { createSignal } from "solid-js";
import { createSimpleContext } from "./simple-context";

type PromptMarkers = Record<string, string | undefined>;

const NO_MARKERS: PromptMarkers = {};

interface ServerPromptMarkers {
  presentedPromptResolutions: () => PromptMarkers;
  setPresentedPromptResolutions: (update: (current: PromptMarkers) => PromptMarkers) => void;
  submittedPromptRequests: () => PromptMarkers;
  setSubmittedPromptRequests: (update: (current: PromptMarkers) => PromptMarkers) => void;
}

const AnsweredPrompts = createSimpleContext({
  name: "Answered prompts",
  init: () => {
    const [presentedByServer, setPresentedByServer] = createSignal<Record<string, PromptMarkers | undefined>>({});
    const [submittedByServer, setSubmittedByServer] = createSignal<Record<string, PromptMarkers | undefined>>({});

    function promptMarkersFor(serverId: string): ServerPromptMarkers {
      return {
        presentedPromptResolutions: () => presentedByServer()[serverId] ?? NO_MARKERS,
        setPresentedPromptResolutions: (update) =>
          setPresentedByServer((current) => ({ ...current, [serverId]: update(current[serverId] ?? NO_MARKERS) })),
        submittedPromptRequests: () => submittedByServer()[serverId] ?? NO_MARKERS,
        setSubmittedPromptRequests: (update) =>
          setSubmittedByServer((current) => ({ ...current, [serverId]: update(current[serverId] ?? NO_MARKERS) })),
      };
    }

    return { promptMarkersFor };
  },
});

export const AnsweredPromptsProvider = AnsweredPrompts.provider;
export const useAnsweredPrompts = AnsweredPrompts.use;
