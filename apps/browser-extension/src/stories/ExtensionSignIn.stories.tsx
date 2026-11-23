import type { CentralAuthState } from "@openbot/contracts/ipc";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MicrophonePage } from "../MicrophonePage";
import { SignInScreen } from "../SignInScreen";
import { PanelFrame } from "./story-frame";

const meta = {
  title: "Extension/Sign in",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function SignIn(props: { login: CentralAuthState }) {
  return (
    <PanelFrame>
      <div class="ext-login">
        <SignInScreen
          login={props.login}
          onRetry={async () => undefined}
          onRequestEmailCode={async () => undefined}
          onVerifyEmailCode={async () => undefined}
          onReset={async () => undefined}
          onSignedIn={async () => undefined}
        />
      </div>
    </PanelFrame>
  );
}

export const SignedOut: Story = { render: () => <SignIn login={{ status: "signed_out" }} /> };

export const CheckingSession: Story = { render: () => <SignIn login={{ status: "loading" }} /> };

export const CodeSent: Story = {
  render: () => (
    <SignIn
      login={{
        status: "code_sent",
        challengeId: "challenge-story",
        email: "person@example.com",
        expiresAt: Date.now() + 600_000,
        resendAvailableAt: Date.now() + 60_000,
        developmentCode: "4K7Q2ZPM",
      }}
    />
  ),
};

export const Cancelled: Story = {
  render: () => (
    <SignIn
      login={{
        status: "error",
        issue: { code: "sign_in_cancelled", message: "The sign-in did not finish. Try again." },
      }}
    />
  ),
};

export const AccountServiceDown: Story = {
  render: () => (
    <SignIn
      login={{
        status: "error",
        issue: { code: "auth_api_unavailable", message: "OpenBot cannot reach its sign-in service. Try again." },
      }}
    />
  ),
};

function Microphone(props: { answer: "asking" | "allowed" | "blocked" }) {
  const media = navigator.mediaDevices;
  if (media)
    Object.defineProperty(media, "getUserMedia", {
      configurable: true,
      value: () =>
        props.answer === "allowed"
          ? Promise.resolve(new MediaStream())
          : props.answer === "blocked"
            ? Promise.reject(new Error("Blocked"))
            : new Promise(() => undefined),
    });
  return (
    <PanelFrame>
      <MicrophonePage />
    </PanelFrame>
  );
}

export const MicrophoneAsking: Story = { render: () => <Microphone answer="asking" /> };
export const MicrophoneAllowed: Story = { render: () => <Microphone answer="allowed" /> };
export const MicrophoneBlocked: Story = { render: () => <Microphone answer="blocked" /> };
