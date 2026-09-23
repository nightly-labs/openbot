/**
 * A code sign-in that answers like the real one, for the surfaces that offer it.
 *
 * Onboarding and Settings each pass one `ProviderCodeLoginApi` down to their provider rows, so a
 * story that wants to show the button also has to show what pressing it does. This is that: a
 * provider that issues a code after a moment, and a fake other device that finishes a few seconds
 * later. The ending closes the dialog and raises a notification, the way the store does. It holds
 * no real code and talks to nothing.
 */

import { type AgentProviderId, agentProviderDescriptor } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { createSignal } from "solid-js";
import type { ProviderCodeLoginApi } from "../src/components/provider-code-login-api";

export interface FakeCodeLoginOptions {
  /** Seconds the fake other device takes. 0 leaves the code on screen for as long as the story is open. */
  finishAfterMs?: number;
  userCode?: string;
}

export function createFakeCodeLogin(options: FakeCodeLoginOptions = {}): ProviderCodeLoginApi {
  const userCode = options.userCode ?? "KTQ4-B62MX";
  const finishAfterMs = options.finishAfterMs ?? 6_000;
  const [provider, setProvider] = createSignal<AgentProviderId | null>(null);
  const [state, setState] = createSignal<ProviderCodeLoginState>({ phase: "starting" });
  const timers: number[] = [];

  function clear(): void {
    while (timers.length > 0) window.clearTimeout(timers.pop());
  }

  function start(next: AgentProviderId): void {
    clear();
    setProvider(next);
    setState({ phase: "starting" });
    timers.push(
      window.setTimeout(() => {
        setState({
          phase: "waiting",
          userCode,
          verificationUrl: "https://auth.openai.com/codex/device",
          expiresAt: Date.now() + 5 * 60_000,
        });
        if (finishAfterMs <= 0) return;
        timers.push(
          window.setTimeout(() => {
            setState({ phase: "verifying" });
            timers.push(
              window.setTimeout(() => {
                close();
                toast.success(`${agentProviderDescriptor(next).displayName} connected`, {
                  description: "Signed in as person@example.com.",
                });
              }, 1_200),
            );
          }, finishAfterMs),
        );
      }, 700),
    );
  }

  function close(): void {
    clear();
    setProvider(null);
  }

  return { provider, state, start, cancel: close, openVerificationUrl: () => undefined };
}
