import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { type RenderedEmail, renderSignInCodeEmail, renderTeamInviteEmail } from "../../server/email-templates";

// Each email renders inside an iframe, as a mail client shows it: the template's own markup and
// `<style>` block apply, and Storybook's stylesheet does not leak in.

const INVITE_URL =
  "https://openbot.run/join?api=https%3A%2F%2Fstudio-mac-k7m4q2pz-host.openbot.run%2F&server=00000000-0000-4000-8000-000000000000&fingerprint=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&invite=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

interface EmailPreviewProps {
  email: RenderedEmail;
  width: number;
  scheme: "light" | "dark";
}

function EmailPreview(props: EmailPreviewProps) {
  return (
    <div style={{ display: "grid", gap: "12px", padding: "24px", "font-family": "system-ui, sans-serif" }}>
      <div style={{ "font-size": "13px", color: "#888" }}>
        <div>
          <strong>Subject:</strong> {props.email.subject}
        </div>
        <div>
          <strong>Preview:</strong> {props.email.preheader}
        </div>
      </div>
      <iframe
        title={props.email.subject}
        srcdoc={props.email.html}
        style={{
          width: `${props.width}px`,
          height: "720px",
          border: "1px solid #3334",
          "border-radius": "8px",
          "color-scheme": props.scheme,
        }}
      />
    </div>
  );
}

function PlainTextPreview(props: { email: RenderedEmail }) {
  return (
    <pre style={{ margin: "24px", padding: "16px", "white-space": "pre-wrap", "font-size": "13px", color: "#ddd" }}>
      {`Subject: ${props.email.subject}\n\n${props.email.text}`}
    </pre>
  );
}

const meta = {
  title: "Site/Emails",
  component: EmailPreview,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  argTypes: {
    width: { control: { type: "range", min: 320, max: 760, step: 10 } },
    scheme: { control: "inline-radio", options: ["light", "dark"] },
  },
  args: {
    width: 640,
    scheme: "light",
    email: renderSignInCodeEmail({ code: "K7M4-Q2PZ", expiresInMinutes: 10 }),
  },
} satisfies Meta<typeof EmailPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignInCode: Story = {};

export const SignInCodeDark: Story = {
  args: { scheme: "dark" },
};

export const SignInCodeMobile: Story = {
  args: { width: 375 },
};

export const TeamInvite: Story = {
  args: {
    email: renderTeamInviteEmail({
      inviterEmail: "owner@example.com",
      serverName: "Studio Mac",
      inviteUrl: INVITE_URL,
      role: "member",
    }),
  },
};

export const TeamInviteAdminDark: Story = {
  args: {
    scheme: "dark",
    email: renderTeamInviteEmail({
      inviterEmail: "norbert@example.com",
      serverName: "Nightly Labs Build Server",
      inviteUrl: INVITE_URL,
      role: "admin",
    }),
  },
};

export const TeamInviteMobile: Story = {
  args: {
    width: 375,
    email: renderTeamInviteEmail({
      inviterEmail: "a.very.long.address.for.wrapping@example-company.com",
      serverName: "Design & <Research> Mac mini",
      inviteUrl: INVITE_URL,
      role: "member",
    }),
  },
};

export const PlainTextBodies: Story = {
  render: () => (
    <div>
      <PlainTextPreview email={renderSignInCodeEmail({ code: "K7M4-Q2PZ", expiresInMinutes: 10 })} />
      <PlainTextPreview
        email={renderTeamInviteEmail({
          inviterEmail: "owner@example.com",
          serverName: "Studio Mac",
          inviteUrl: INVITE_URL,
          role: "member",
        })}
      />
    </div>
  ),
};
