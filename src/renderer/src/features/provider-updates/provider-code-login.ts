import {
  type AgentProviderId,
  type AgentStatus,
  agentProviderDescriptor,
  type ProviderCodeLoginStart,
} from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { createEffect, createSignal, flush, onCleanup } from "solid-js";
import type { ProviderCodeLoginApi } from "../../components/provider-code-login-api";

/** The computer that runs the providers: it issues the code, and a cancel goes to the same one. */
interface ProviderCodeLoginTarget {
  start: (provider: AgentProviderId) => Promise<ProviderCodeLoginStart>;
  cancel: (provider: AgentProviderId) => Promise<AgentStatus>;
}

export interface ProviderCodeLoginOptions {
  /** The status of the computer that runs the providers. It says how a sign-in ends. */
  agentStatus: () => AgentStatus;
  applyStatus: (status: AgentStatus) => void;
  /** Read when a sign-in starts. The cancel of that sign-in goes to the same target. */
  target: () => ProviderCodeLoginTarget;
  openVerificationUrl: (url: string) => void;
  /**
   * A connect attempt, for analytics: begun when a sign-in starts, failed through the function it
   * returns, and dropped when the user cancels.
   */
  connection?: {
    begin: (provider: AgentProviderId) => () => void;
    drop: (provider: AgentProviderId) => void;
  };
}

/**
 * The sign-in the user finishes on another device, for a provider whose descriptor offers one.
 *
 * Everything about how it ends arrives in the agent status, the same way a browser sign-in's
 * does, so this holds only what the status cannot say: which provider the open dialog belongs
 * to, and the code that provider issued. The code is a one-time handle and is meant to be read
 * out; nothing it is later traded for reaches the renderer.
 */
export function createProviderCodeLogin(options: ProviderCodeLoginOptions): ProviderCodeLoginApi {
  /** The provider whose code dialog is open, and the phase that dialog shows. */
  const [codeLoginProvider, setCodeLoginProvider] = createSignal<AgentProviderId | null>(null);
  const [codeLoginState, setCodeLoginState] = createSignal<ProviderCodeLoginState>({ phase: "starting" });
  let codeLoginExpiry: number | undefined;
  /** Whether the provider has been seen working on the open code sign-in. */
  let codeLoginStarted = false;
  let codeLoginGeneration = 0;
  let codeLoginCancellation: Promise<void> = Promise.resolve();
  /** The computer that runs the open code sign-in. */
  let codeLoginTarget: ProviderCodeLoginTarget | undefined;

  async function startProviderCodeLogin(provider: AgentProviderId): Promise<void> {
    const generation = ++codeLoginGeneration;
    clearCodeLoginExpiry();
    codeLoginStarted = false;
    // The code is issued by the computer the providers run on; the admin types it in the browser of
    // this one.
    const target = options.target();
    codeLoginTarget = target;
    setCodeLoginProvider(provider);
    setCodeLoginState({ phase: "starting" });
    const failConnection = options.connection?.begin(provider);
    try {
      // Cancellation emits a terminal status. Finish it before the next attempt can wait.
      await codeLoginCancellation;
      if (generation !== codeLoginGeneration) return;
      const started = await target.start(provider);
      // A dialog the user closed while the provider was answering: the login was cancelled with
      // it, so there is nobody left to show a code to.
      if (generation !== codeLoginGeneration) return;
      if (started.kind === "connected") {
        const row = options.agentStatus().providers?.find((candidate) => candidate.id === provider);
        endProviderCodeLogin(provider, { kind: "connected", accountLabel: row?.email ?? null });
        return;
      }
      flush(() =>
        setCodeLoginState({
          phase: "waiting",
          userCode: started.userCode,
          verificationUrl: started.verificationUrl,
          expiresAt: started.expiresAt,
        }),
      );
      // Main gives up on the same deadline and reports a failure, but the user is looking at a
      // countdown: when it reaches zero the screen has to say so without waiting for a round trip.
      codeLoginExpiry = window.setTimeout(
        () => {
          if (generation !== codeLoginGeneration) return;
          codeLoginExpiry = undefined;
          if (codeLoginState().phase === "waiting") endProviderCodeLogin(provider, { kind: "expired" });
        },
        Math.max(0, started.expiresAt - Date.now()),
      );
    } catch (error) {
      if (generation !== codeLoginGeneration) return;
      failConnection?.();
      endProviderCodeLogin(provider, {
        kind: "failed",
        message:
          error instanceof Error && error.message
            ? error.message
            : `OpenBot could not connect ${agentProviderDescriptor(provider).displayName}. Try again.`,
      });
    }
  }

  /** Abandons the code sign-in and closes the dialog. The code stops working before this returns. */
  function cancelProviderCodeLogin(): void {
    const provider = codeLoginProvider();
    const generation = ++codeLoginGeneration;
    codeLoginStarted = false;
    clearCodeLoginExpiry();
    setCodeLoginProvider(null);
    const target = codeLoginTarget;
    if (!provider || !target) return;
    options.connection?.drop(provider);
    codeLoginCancellation = target
      .cancel(provider)
      .then((status) => {
        if (generation === codeLoginGeneration) flush(() => options.applyStatus(status));
      })
      // The provider has already stopped waiting for the code in every case that fails here: a
      // login that was never started, or one that ended on its own while the dialog was open.
      .catch(() => undefined);
  }

  /**
   * Closes the dialog on an ending and says how it went in a notification.
   *
   * Not a last screen in the dialog: the user finished this sign-in on another device, so they
   * come back to an app that should already be theirs to use, not to a modal to dismiss. The
   * notification carries the retry, because "the code expired" with no way to ask for another
   * one is a dead end.
   */
  function endProviderCodeLogin(
    provider: AgentProviderId,
    outcome:
      | { kind: "connected"; accountLabel: string | null }
      | { kind: "expired" }
      | { kind: "failed"; message: string },
  ): void {
    codeLoginGeneration++;
    clearCodeLoginExpiry();
    codeLoginStarted = false;
    flush(() => setCodeLoginProvider(null));
    const name = agentProviderDescriptor(provider).displayName;
    if (outcome.kind === "connected") {
      toast.success(`${name} connected`, {
        description: outcome.accountLabel
          ? `Signed in as ${outcome.accountLabel}.`
          : "The sign-in finished on the other device.",
      });
      return;
    }
    const retry = { label: "Get a new code", onClick: () => void startProviderCodeLogin(provider) };
    if (outcome.kind === "expired") {
      toast.warning(`The ${name} code expired`, {
        description: "Nobody entered it in time. That code no longer works.",
        action: retry,
      });
      return;
    }
    toast.error(`Could not connect ${name}`, {
      description: outcome.message,
      action: { ...retry, label: "Try again" },
    });
  }

  function clearCodeLoginExpiry(): void {
    if (codeLoginExpiry === undefined) return;
    window.clearTimeout(codeLoginExpiry);
    codeLoginExpiry = undefined;
  }

  /**
   * How a code sign-in ends: the provider's own status, which is what a browser sign-in reports
   * too. An account means it worked; anything else that stops the connect means it did not.
   *
   * The row has to be seen working on this login before its end is read out of it. A provider the
   * user is already signed in to is `available` from the start, and taking that for the finish
   * reported success as soon as the code appeared: nobody asking for a second account ever got to
   * type one.
   */
  createEffect(
    () => {
      const provider = codeLoginProvider();
      // The phase belongs in here rather than in the callback: a reactive read in an effect
      // callback is not tracked, so a dialog that reached `waiting` after the status did would
      // never be told about it.
      if (provider === null || codeLoginState().phase !== "waiting") return null;
      return options.agentStatus().providers?.find((row) => row.id === provider) ?? null;
    },
    (row) => {
      if (!row) return;
      if (row.connectionState === "connecting") {
        codeLoginStarted = true;
        return;
      }
      if (!codeLoginStarted) return;
      codeLoginStarted = false;
      if (row.state === "available" && !row.message) {
        endProviderCodeLogin(row.id, { kind: "connected", accountLabel: row.email ?? null });
      } else {
        endProviderCodeLogin(row.id, {
          kind: "failed",
          message:
            row.message ?? `OpenBot could not connect ${agentProviderDescriptor(row.id).displayName}. Try again.`,
        });
      }
    },
  );

  onCleanup(() => {
    codeLoginGeneration++;
    clearCodeLoginExpiry();
  });

  return {
    provider: codeLoginProvider,
    state: codeLoginState,
    start: (provider) => void startProviderCodeLogin(provider),
    cancel: cancelProviderCodeLogin,
    openVerificationUrl: options.openVerificationUrl,
  };
}
