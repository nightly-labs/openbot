/**
 * Signing in to ChatGPT with a code, one screen per phase.
 *
 * The flow leaves the app: the code is typed on a phone or another browser, and OpenBot only hears
 * how it ended. The dialog covers the waiting; how it ended is a notification the providers store
 * raises, so the endings are not screens here at all.
 *
 * `Playground` runs the hand-off end to end against a fake other device, so the waiting, the finish
 * and the notification it leaves behind are watchable and not only described.
 */

import { Toaster, toast } from "@openbot/ui";
import { ProviderCodeLoginDialog, type ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { createSignal, onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const USER_CODE = "KTQ4-B62MX";
const VERIFICATION_URL = "https://auth.openai.com/codex/device";
const VERIFICATION_URL_COMPLETE = "https://auth.openai.com/codex/device?user_code=KTQ4-B62MX";

/**
 * Far enough out that the countdown reads like a fresh code and does not run down mid-review.
 *
 * No pre-filled link, because ChatGPT issues none: the QR carries the plain page and the code is
 * typed from this screen. `PrefilledLink` covers the provider that does issue one.
 */
function waitingState(minutes = 5): ProviderCodeLoginState {
  return {
    phase: "waiting",
    userCode: USER_CODE,
    verificationUrl: VERIFICATION_URL,
    expiresAt: Date.now() + minutes * 60_000,
  };
}

const meta = {
  title: "Auth/ProviderCodeLoginDialog",
  component: ProviderCodeLoginDialog,
  args: {
    open: true,
    providerName: "ChatGPT",
    state: waitingState(),
    onOpenVerificationUrl: fn(),
    onCancel: fn(),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProviderCodeLoginDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The code is on screen and the provider has not answered. The whole reason the flow exists. */
export const Waiting: Story = {};

/**
 * A provider that puts the code in the link itself. Scanning this QR opens a page that needs no
 * typing, so the code below it is the fallback rather than the step.
 */
export const PrefilledLink: Story = {
  args: {
    state: {
      phase: "waiting",
      userCode: USER_CODE,
      verificationUrl: VERIFICATION_URL,
      verificationUrlComplete: VERIFICATION_URL_COMPLETE,
      expiresAt: Date.now() + 5 * 60_000,
    },
  },
};

/** The last seconds, where the countdown is the thing being read. */
export const AboutToExpire: Story = {
  args: { state: waitingState(0.25) },
};

/** Asking the provider for a code. Two seconds in the real flow, and nothing to do in them. */
export const Starting: Story = {
  args: { state: { phase: "starting" } },
};

/** The code was accepted elsewhere. OpenBot is trading it for the session. */
export const Verifying: Story = {
  args: { state: { phase: "verifying" } },
};

/**
 * The whole hand-off, watchable: the code appears, a fake other device answers a few seconds later,
 * the sign-in finishes, and the dialog gives way to the notification that says which account
 * arrived. Cancel closes it instead.
 *
 * The wait is shortened to seconds. In the app it is however long the user takes on the phone.
 */
export const Playground: Story = {
  render: (storyArgs) => {
    const [state, setState] = createSignal<ProviderCodeLoginState>({ phase: "starting" });
    const [open, setOpen] = createSignal(true);
    const timers: number[] = [];

    function after(ms: number, run: () => void) {
      timers.push(window.setTimeout(run, ms));
    }

    function start() {
      while (timers.length > 0) window.clearTimeout(timers.pop());
      setOpen(true);
      setState({ phase: "starting" });
      after(900, () => {
        setState(waitingState());
        after(5_000, () => {
          setState({ phase: "verifying" });
          // The store does this in the app: the ending closes the dialog and is announced, rather
          // than leaving a modal for someone who has been away on their phone to dismiss.
          after(1_200, () => {
            setOpen(false);
            toast.success("ChatGPT connected", { description: "Signed in as person@example.com." });
          });
        });
      });
    }

    // The first step waits for the render to finish: the story drives its own state from outside
    // the component, the way the app drives it from IPC rather than from the render.
    queueMicrotask(start);
    onCleanup(() => {
      while (timers.length > 0) window.clearTimeout(timers.pop());
    });

    return (
      <>
        <ProviderCodeLoginDialog {...storyArgs} open={open()} state={state()} onCancel={() => setOpen(false)} />
        <Toaster />
      </>
    );
  },
};
