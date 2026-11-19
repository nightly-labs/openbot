import { Toaster, toast } from "@openbot/ui";
import { ProviderCodeLoginDialog, type ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { createSignal, onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const USER_CODE = "KTQ4-B62MX";
const VERIFICATION_URL = "https://auth.openai.com/codex/device";
const VERIFICATION_URL_COMPLETE = "https://auth.openai.com/codex/device?user_code=KTQ4-B62MX";

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
    setupStep:
      "In ChatGPT on a computer, open the security settings and turn on device code sign-in for Codex. For a work account, your workspace admin turns it on.",
    onOpenVerificationUrl: fn(),
    onCancel: fn(),
    onSubmitCode: fn(),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProviderCodeLoginDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = {};

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

export const AboutToExpire: Story = {
  args: { state: waitingState(0.25) },
};

export const Starting: Story = {
  args: { state: { phase: "starting" } },
};

const PASTE_URL = "https://claude.com/cai/oauth/authorize?code=true&state=preview";

export const Paste: Story = {
  args: {
    providerName: "Claude",
    state: { phase: "paste", verificationUrl: PASTE_URL, expiresAt: Date.now() + 10 * 60_000 },
  },
};

export const PasteRefused: Story = {
  args: {
    providerName: "Claude",
    state: {
      phase: "paste",
      verificationUrl: PASTE_URL,
      expiresAt: Date.now() + 10 * 60_000,
      error: "Paste the code that the sign-in page shows.",
    },
  },
};

export const Link: Story = {
  args: {
    providerName: "Cursor",
    state: {
      phase: "link",
      verificationUrl: "https://cursor.com/loginDeepControl?mode=login&redirectTarget=cli",
      expiresAt: Date.now() + 10 * 60_000,
    },
  },
};

export const Verifying: Story = {
  args: { state: { phase: "verifying" } },
};

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
          after(1_200, () => {
            setOpen(false);
            toast.success("ChatGPT connected", { description: "Signed in as person@example.com." });
          });
        });
      });
    }

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

export const HostPageOpening: Story = {
  args: {
    providerName: "Gemini",
    state: { phase: "page", hostName: "Office server", page: null },
  },
};

export const RelayDevice: Story = {
  args: {
    state: {
      phase: "relay",
      hostName: "Cloud server",
      page: {
        authorizeHost: "auth.openai.com",
        url: "https://auth.openai.com/codex/device",
        listening: false,
        pasteable: false,
      },
    },
    onOpenRelayPage: fn(),
    onPasteRelayAddress: fn(),
  },
};

export const RelayNoLink: Story = {
  args: {
    state: {
      phase: "relay",
      hostName: "Cloud server",
      page: { authorizeHost: "auth.openai.com", url: null, listening: false, pasteable: false },
    },
    onOpenRelayPage: fn(),
    onPasteRelayAddress: fn(),
  },
};

export const RelayPaste: Story = {
  args: {
    providerName: "Claude",
    state: {
      phase: "relay",
      hostName: "Cloud server",
      page: {
        authorizeHost: "claude.com",
        url: "https://claude.com/cai/oauth/authorize?state=example",
        listening: false,
        pasteable: true,
      },
    },
    onOpenRelayPage: fn(),
    onPasteRelayAddress: fn(),
  },
};
