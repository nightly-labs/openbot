import type { DeviceToolApp, DeviceToolOperation } from "@openbot/contracts/team-protocol/device-tools-v1";
import { router } from "expo-router";
import { create } from "zustand";

/**
 * What the user chose. `dismissed` is a swipe down or a request that closed on another phone: it
 * refuses the request but saves nothing.
 */
export type ConsentChoice = "once" | "always" | "deny" | "dismissed";

export interface ConsentPrompt {
  requestId: string;
  app: DeviceToolApp;
  operation: DeviceToolOperation;
  /** The title of the event or reminder that the agent adds, which the user reads before they agree. */
  title?: string;
}

/** The prompts that wait for an answer, the first one on screen. Several requests can arrive together. */
export const useDeviceAppConsent = create<{ prompts: readonly ConsentPrompt[] }>(() => ({ prompts: [] }));

const waiting = new Map<string, (choice: ConsentChoice) => void>();

export function askDeviceAppConsent(prompt: ConsentPrompt): Promise<ConsentChoice> {
  return new Promise((resolve) => {
    waiting.set(prompt.requestId, resolve);
    const first = useDeviceAppConsent.getState().prompts.length === 0;
    useDeviceAppConsent.setState((state) => ({ prompts: [...state.prompts, prompt] }));
    // The sheet stays open and shows the next prompt. The screen closes it when none is left.
    if (first) router.push("/device-app-consent");
  });
}

function settle(requestId: string, choice: ConsentChoice): void {
  const resolve = waiting.get(requestId);
  waiting.delete(requestId);
  useDeviceAppConsent.setState((state) => ({ prompts: state.prompts.filter((p) => p.requestId !== requestId) }));
  resolve?.(choice);
}

export function answerDeviceAppConsent(requestId: string, choice: Exclude<ConsentChoice, "dismissed">): void {
  settle(requestId, choice);
}

/** The host closed the request, for example because another phone answered it first. */
export function cancelDeviceAppConsent(requestId: string): void {
  settle(requestId, "dismissed");
}

/** The sheet went away with prompts open. */
export function dismissDeviceAppConsents(): void {
  for (const { requestId } of useDeviceAppConsent.getState().prompts) settle(requestId, "dismissed");
}
