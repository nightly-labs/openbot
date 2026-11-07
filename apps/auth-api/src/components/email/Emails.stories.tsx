import { licensePeriodAmount } from "@openbot/contracts/license";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  type LicenseEmailInput,
  type RenderedEmail,
  renderLicenseEmail,
  renderSignInCodeEmail,
  renderTeamInviteEmail,
  renderWelcomeEmail,
} from "../../server/email-templates";

// Each email renders inside an iframe, as a mail client shows it: the template's own markup and
// `<style>` block apply, and Storybook's stylesheet does not leak in.

const INVITE_URL =
  "https://openbot.run/join?api=https%3A%2F%2Fstudio-mac-k7m4q2pz-host.openbot.run%2F&server=00000000-0000-4000-8000-000000000000&fingerprint=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&invite=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const TEAM_LICENSE: LicenseEmailInput = {
  kind: "welcome",
  plan: { tier: "team", interval: "year", bundle: false },
  users: 10,
  currency: "eur",
  amount: licensePeriodAmount({ tier: "team", interval: "year", bundle: false }, 10, "eur"),
  nextPaymentAt: Date.parse("2027-11-01T09:14:00Z"),
};
const BUNDLE_LICENSE: LicenseEmailInput = {
  kind: "welcome",
  plan: { tier: "team", interval: "month", bundle: true },
  users: 3,
  currency: "pln",
  amount: licensePeriodAmount({ tier: "team", interval: "month", bundle: true }, 3, "pln"),
  nextPaymentAt: Date.parse("2026-12-01T13:42:00Z"),
};
const STARTER_LICENSE: LicenseEmailInput = {
  kind: "welcome",
  plan: { tier: "starter", interval: "year", bundle: false },
  users: 1,
  currency: "usd",
  amount: licensePeriodAmount({ tier: "starter", interval: "year", bundle: false }, 1, "usd"),
  nextPaymentAt: null,
};
const PAYMENT_FAILED: LicenseEmailInput = {
  kind: "payment_failed",
  plan: { tier: "team", interval: "month", bundle: false },
  users: 5,
  currency: "eur",
  amount: licensePeriodAmount({ tier: "team", interval: "month", bundle: false }, 5, "eur"),
  nextAttemptAt: Date.parse("2026-11-05T10:20:00Z"),
  invoiceUrl: "https://invoice.stripe.com/i/acct_1Example/test_YWNjdF8xRXhhbXBsZQ",
};
const LAST_PAYMENT_FAILED: LicenseEmailInput = { ...PAYMENT_FAILED, nextAttemptAt: null, invoiceUrl: null };
const ENDED_UNPAID: LicenseEmailInput = {
  kind: "ended",
  plan: { tier: "team", interval: "month", bundle: false },
  users: 5,
  reason: "unpaid",
};
const ENDED_CANCELED: LicenseEmailInput = {
  kind: "ended",
  plan: { tier: "starter", interval: "year", bundle: false },
  users: 1,
  reason: "canceled",
};

interface EmailPreviewProps {
  email: RenderedEmail;
  width: number;
  scheme: "light" | "dark";
}

/** Makes the frame as tall as the email, so that a long email is not cut off. */
function fitToContent(frame: HTMLIFrameElement) {
  const height = frame.contentDocument?.body.scrollHeight;
  if (height) frame.style.height = `${height}px`;
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
        onLoad={(event) => fitToContent(event.currentTarget)}
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

export const Welcome: Story = {
  args: { email: renderWelcomeEmail({ plan: "standard", serverName: "Studio Mac" }) },
};

export const WelcomeDark: Story = {
  args: { scheme: "dark", email: renderWelcomeEmail({ plan: "pro", serverName: "Nightly Labs Build Server" }) },
};

export const WelcomeMobile: Story = {
  args: { width: 375, email: renderWelcomeEmail({ plan: "starter", serverName: "Design & <Research> Mac mini" }) },
};

export const LicenseWelcome: Story = {
  args: { email: renderLicenseEmail(TEAM_LICENSE) },
};

export const LicenseWelcomeBundleDark: Story = {
  args: { scheme: "dark", email: renderLicenseEmail(BUNDLE_LICENSE) },
};

/** A Starter license that ends at its period end, so it has no next payment. */
export const LicenseWelcomeStarterMobile: Story = {
  args: { width: 375, email: renderLicenseEmail(STARTER_LICENSE) },
};

/** A renewal payment failed. Stripe tries again, so the license stays active. */
export const LicensePaymentFailed: Story = {
  args: { email: renderLicenseEmail(PAYMENT_FAILED) },
};

/** The last try failed, and the event had no invoice page, so the button opens the web app. */
export const LicensePaymentFailedLastTryDark: Story = {
  args: { scheme: "dark", email: renderLicenseEmail(LAST_PAYMENT_FAILED) },
};

export const LicenseEndedUnpaid: Story = {
  args: { email: renderLicenseEmail(ENDED_UNPAID) },
};

export const LicenseEndedCanceledMobile: Story = {
  args: { width: 375, email: renderLicenseEmail(ENDED_CANCELED) },
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
      <PlainTextPreview email={renderWelcomeEmail({ plan: "standard", serverName: "Studio Mac" })} />
      <PlainTextPreview email={renderLicenseEmail(TEAM_LICENSE)} />
      <PlainTextPreview email={renderLicenseEmail(PAYMENT_FAILED)} />
      <PlainTextPreview email={renderLicenseEmail(ENDED_UNPAID)} />
    </div>
  ),
};
