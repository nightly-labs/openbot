import type { BillingCurrency, BillingPlanId } from "@openbot/contracts/billing";
import { LICENSE_DEVICES_PER_USER, type LicensePlan, type LicenseTier } from "@openbot/contracts/license";
import { OPENBOT_DOWNLOAD_PAGE_LINKS, OPENBOT_LINKS } from "../lib/landing-links";

// HTML and plain-text bodies for account email. Mail clients render HTML very differently, so the
// markup keeps to what all of them share:
// - Tables and inline styles only. Gmail and Outlook drop or limit `<style>`, so that block holds
//   optional improvements (dark mode, narrow screens) and a client without it still gets the
//   light layout.
// - Outlook for Windows renders with Word: it ignores `max-width` and `border-radius` and padding
//   on links, so `<!--[if mso]>` blocks give it a fixed-width frame and a VML button.
// - Images are often blocked until the reader allows them, so the logo has styled alt text and no
//   content is an image.
// - Clients that force a dark theme (Outlook.com, Gmail apps) rewrite colours on their own; the
//   `[data-ogsc]` rules answer Outlook.com, and the light palette inverts cleanly elsewhere.
// Every message also carries the plain-text body, for clients and readers that do not show HTML.

export interface RenderedEmail {
  subject: string;
  preheader: string;
  text: string;
  html: string;
}

export interface SignInCodeEmailInput {
  code: string;
  expiresInMinutes: number;
}

export interface TeamInviteEmailInput {
  inviterEmail: string;
  serverName: string;
  inviteUrl: string;
  role: "admin" | "member";
}

export interface ContactMessageEmailInput {
  name: string | null;
  email: string;
  company: string | null;
  topic: string;
  message: string;
}

export interface WelcomeEmailInput {
  plan: BillingPlanId;
  serverName: string;
}

/** The first payment of a license. */
interface LicenseWelcomeEmailInput {
  plan: LicensePlan;
  users: number;
  currency: BillingCurrency;
  /** The list price of one period, in minor units of `currency`. Null when a discount changes it. */
  amount: number | null;
  /** The next payment, in milliseconds since the epoch. Null when no payment follows. */
  nextPaymentAt: number | null;
}

/** A renewal payment of a license that failed. */
interface LicensePaymentFailedEmailInput {
  plan: LicensePlan;
  users: number;
  currency: BillingCurrency;
  /** The unpaid amount, in minor units of `currency`. */
  amount: number;
  /** Stripe's next try, in milliseconds since the epoch. Null when Stripe does not try again. */
  nextAttemptAt: number | null;
  /** Stripe's page for the unpaid invoice. Null sends the user to the web app. */
  invoiceUrl: string | null;
}

/** A license that ended. */
interface LicenseEndedEmailInput {
  plan: LicensePlan;
  users: number;
  /** `unpaid` after the last failed try; `canceled` for a cancel, a refund, or a dispute. */
  reason: "unpaid" | "canceled";
}

export type LicenseEmailInput =
  | ({ kind: "welcome" } & LicenseWelcomeEmailInput)
  | ({ kind: "payment_failed" } & LicensePaymentFailedEmailInput)
  | ({ kind: "ended" } & LicenseEndedEmailInput);

const SITE_URL = "https://openbot.run";
const WEB_APP_URL = `${SITE_URL}/app`;
const DOWNLOAD_URL = `${SITE_URL}${OPENBOT_DOWNLOAD_PAGE_LINKS.hub}`;
const PRICING_URL = `${SITE_URL}/pricing`;
const PLAN_NAMES: Record<BillingPlanId, string> = { starter: "Starter", standard: "Standard", pro: "Pro" };
const LICENSE_TIER_NAMES: Record<LicenseTier, string> = { starter: "Starter", team: "Team" };
const LOGO_URL = `${SITE_URL}/icon-192x192.png`;
const FOOTER_LINKS = [
  { label: "openbot.run", href: SITE_URL },
  { label: "X", href: OPENBOT_LINKS.x },
  { label: "GitHub", href: OPENBOT_LINKS.repository },
] as const;
const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, Helvetica, Arial, sans-serif";
const MONO_STACK = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";
// Filler after the preheader, so a client's inbox preview does not continue into the body text.
const PREHEADER_FILLER = "&#8199;&#65279;&#847; ".repeat(60);

const COLOR = {
  page: "#f4f4f2",
  card: "#ffffff",
  border: "#e7e7e4",
  text: "#161616",
  muted: "#6b6b6b",
  faint: "#9a9a9a",
  codeBg: "#f4f0fb",
  codeBorder: "#e4d7f7",
  button: "#161616",
  buttonText: "#ffffff",
};

export function renderSignInCodeEmail(input: SignInCodeEmailInput): RenderedEmail {
  const minutes = `${input.expiresInMinutes} minute${input.expiresInMinutes === 1 ? "" : "s"}`;
  const subject = "Your OpenBot sign-in code";
  const preheader = `${input.code} is your OpenBot sign-in code. It expires in ${minutes}.`;
  const footer = "If you did not request this code, you can ignore this email. Nobody can sign in without it.";
  return {
    subject,
    preheader,
    text: textBody(
      ["Use this code to sign in to OpenBot:", "", input.code, "", `This code expires in ${minutes} and works once.`],
      footer,
    ),
    html: renderLayout({
      title: subject,
      preheader,
      body: [
        heading("Your sign-in code"),
        paragraph("Enter this code in OpenBot to finish signing in."),
        codeBlock(input.code),
        paragraph(`The code expires in ${minutes} and works once.`, { muted: true, last: true }),
      ].join(""),
      footer,
    }),
  };
}

export function renderTeamInviteEmail(input: TeamInviteEmailInput): RenderedEmail {
  const serverName = input.serverName.trim();
  const access = input.role === "admin" ? "Admin" : "Member";
  const subject = `Join ${serverName} on OpenBot`;
  const preheader = `${input.inviterEmail} invited you to join ${serverName}.`;
  const footer = "If you did not expect this invitation, you can ignore this email.";
  return {
    subject,
    preheader,
    text: textBody(
      [
        `${input.inviterEmail} invited you to join ${serverName} on OpenBot.`,
        "",
        `Access: ${access}`,
        "",
        "Open this one-time invitation link:",
        input.inviteUrl,
        "",
        "The invitation expires after 24 hours. Sign in with this email address to accept it.",
      ],
      footer,
    ),
    html: renderLayout({
      title: subject,
      preheader,
      body: [
        heading(`Join ${escapeHtml(serverName)}`),
        paragraph(
          `<strong style="color:${COLOR.text};font-weight:600;">${escapeHtml(input.inviterEmail)}</strong> invited you to a team on OpenBot.`,
        ),
        detailRow("Access", access),
        button("Accept invitation", input.inviteUrl),
        paragraph("The link works once and expires after 24 hours. Sign in with this email address to accept it.", {
          muted: true,
        }),
        linkFallback(input.inviteUrl),
      ].join(""),
      footer,
    }),
  };
}

// A message from the contact form on the site, to the team's own mailbox. The visitor wrote every
// field, so the HTML escapes each one, and a reply goes to the visitor through `Reply-To`.
export function renderContactMessageEmail(input: ContactMessageEmailInput): RenderedEmail {
  const sender = input.name ? `${input.name} <${input.email}>` : input.email;
  const fullSubject = `${input.topic} from ${input.name ?? input.email}`;
  const subject = fullSubject.length > 150 ? `${fullSubject.slice(0, 149)}…` : fullSubject;
  const preheader = input.message.slice(0, 120);
  const footer = `Sent from the contact form on openbot.run. Reply to this email to answer ${input.email}.`;
  return {
    subject,
    preheader,
    text: textBody(
      [
        `From: ${sender}`,
        ...(input.company ? [`Company: ${input.company}`] : []),
        `Topic: ${input.topic}`,
        "",
        input.message,
      ],
      footer,
    ),
    html: renderLayout({
      title: subject,
      preheader,
      body: [
        heading(escapeHtml(input.topic)),
        detailRow("From", sender),
        ...(input.company ? [detailRow("Company", input.company)] : []),
        paragraph(escapeHtml(input.message).replace(/\r?\n/gu, "<br>"), { last: true }),
      ].join(""),
      footer,
    }),
  };
}

// Sent once to an account, when its first plan starts. Kamil signs it, and a reply goes to the
// sending mailbox.
export function renderWelcomeEmail(input: WelcomeEmailInput): RenderedEmail {
  const serverName = input.serverName.trim();
  const planName = PLAN_NAMES[input.plan];
  const subject = "Welcome to OpenBot!";
  const thanks = "Thank you for choosing OpenBot to build and run your AI Coworkers.";
  const reachOut =
    "I just wanted to personally say hello and let you know that if you run into any issues or have any feedback or suggestions - feel free to reach out to me directly by replying to this email.";
  const feedback =
    "Every piece of feedback is incredibly valuable to us. We ship updates almost every day, and your feedback shapes what comes next.";
  const footer = "You receive this email because you started an OpenBot subscription.";
  return {
    subject,
    preheader: thanks,
    text: textBody(
      [
        "Hi,",
        "Welcome to OpenBot!",
        thanks,
        "",
        `Plan: ${planName}`,
        `Server: ${serverName}`,
        `Open your server: ${WEB_APP_URL}`,
        "",
        reachOut,
        "",
        feedback,
        "",
        "Best,",
        "Kamil",
      ],
      footer,
    ),
    html: renderLayout({
      title: subject,
      preheader: thanks,
      body: [
        heading("Welcome to OpenBot!", { gap: 16 }),
        paragraph("Hi,", { gap: 16 }),
        paragraph(thanks, { gap: 16 }),
        detailRows([
          ["Plan", planName],
          ["Server", serverName],
        ]),
        button("Open your server", WEB_APP_URL),
        paragraph(reachOut, { gap: 16 }),
        paragraph(feedback, { gap: 24 }),
        paragraph("Best,<br>Kamil", { last: true }),
      ].join(""),
      footer,
    }),
  };
}

/** Each license email goes from the license sender, and a reply goes to that mailbox. */
export function renderLicenseEmail(input: LicenseEmailInput): RenderedEmail {
  switch (input.kind) {
    case "welcome":
      return renderLicenseWelcome(input);
    case "payment_failed":
      return renderLicensePaymentFailed(input);
    case "ended":
      return renderLicenseEnded(input);
  }
}

// Sent once for a license, at its first payment: at once for a paid Checkout, at the end of a free
// trial for a trial. Kamil signs it.
function renderLicenseWelcome(input: LicenseWelcomeEmailInput): RenderedEmail {
  const tierName = LICENSE_TIER_NAMES[input.plan.tier];
  const seats = `${input.users} seat${input.users === 1 ? "" : "s"}`;
  const subject = `Your OpenBot ${tierName} license is active`;
  const preheader = `Thank you for buying OpenBot. Your license covers ${seats}.`;
  const active = "Your license is active. You can use OpenBot for work now.";
  const team =
    input.plan.tier === "team"
      ? "Invite your teammates from your server’s Members settings. The license counts each person once."
      : "Your license covers you. Change to the Team license when you invite teammates.";
  const devices = `Each user can use OpenBot on up to ${LICENSE_DEVICES_PER_USER} devices.`;
  const reply = "If something does not work, or you have an idea, reply to this email. I read every reply.";
  const footer = "You receive this email because you bought an OpenBot license.";
  const rows = licenseRows(input.plan, input.users);
  if (input.amount !== null)
    rows.push(["Price", `${formatAmount(input.amount, input.currency)} / ${input.plan.interval}`]);
  if (input.nextPaymentAt !== null) rows.push(["Next payment", formatDate(input.nextPaymentAt)]);
  return {
    subject,
    preheader,
    text: textBody(
      [
        "Hi,",
        "",
        "Thank you for buying OpenBot.",
        active,
        "",
        ...rows.map(([label, value]) => `${label}: ${value}`),
        "",
        team,
        devices,
        `Download OpenBot: ${DOWNLOAD_URL}`,
        "",
        reply,
        ...SIGNATURE_TEXT,
      ],
      footer,
    ),
    html: renderLayout({
      title: subject,
      preheader,
      body: [
        heading("Thank you for buying OpenBot", { gap: 16 }),
        paragraph("Hi,", { gap: 16 }),
        paragraph(active, { gap: 16 }),
        detailRows(rows),
        paragraph(`${escapeHtml(team)} ${devices}`, { gap: 16 }),
        button("Download OpenBot", DOWNLOAD_URL),
        paragraph(reply, { gap: 24 }),
        SIGNATURE_HTML,
      ].join(""),
      footer,
    }),
  };
}

// Sent once for each unpaid renewal invoice, at its first failed try. Stripe tries again by itself, so
// the license stays active until the last try fails.
function renderLicensePaymentFailed(input: LicensePaymentFailedEmailInput): RenderedEmail {
  const tierName = LICENSE_TIER_NAMES[input.plan.tier];
  const subject = `Payment failed for your OpenBot ${tierName} license`;
  const preheader = "Pay the invoice to keep your license active.";
  const failed = "The payment for your OpenBot license did not go through.";
  const retry =
    input.nextAttemptAt === null
      ? "This was the last try. If the invoice stays unpaid, your license ends."
      : `Your license stays active while we try again on ${formatDate(input.nextAttemptAt)}. If no payment goes through, your license ends.`;
  const action = input.invoiceUrl
    ? "Pay the invoice now. You can use a different card."
    : "Open Billing in the OpenBot settings to pay the invoice.";
  const buttonLabel = input.invoiceUrl ? "Pay the invoice" : "Open OpenBot";
  const url = input.invoiceUrl ?? WEB_APP_URL;
  const reply = "If you have a question, reply to this email.";
  const footer = "You receive this email because you have an OpenBot license.";
  const rows = licenseRows(input.plan, input.users);
  rows.push(["Amount due", formatAmount(input.amount, input.currency)]);
  if (input.nextAttemptAt !== null) rows.push(["Next try", formatDate(input.nextAttemptAt)]);
  return {
    subject,
    preheader,
    text: textBody(
      [
        "Hi,",
        "",
        failed,
        "",
        ...rows.map(([label, value]) => `${label}: ${value}`),
        "",
        retry,
        action,
        `${buttonLabel}: ${url}`,
        "",
        reply,
        ...SIGNATURE_TEXT,
      ],
      footer,
    ),
    html: renderLayout({
      title: subject,
      preheader,
      body: [
        heading("We could not take your payment", { gap: 16 }),
        paragraph("Hi,", { gap: 16 }),
        paragraph(failed, { gap: 16 }),
        detailRows(rows),
        paragraph(`${escapeHtml(retry)} ${escapeHtml(action)}`, { gap: 16 }),
        button(buttonLabel, url),
        paragraph(reply, { gap: 24 }),
        SIGNATURE_HTML,
      ].join(""),
      footer,
    }),
  };
}

// Sent once when a license that had a payment ends. A trial that ends before its first payment gets none.
function renderLicenseEnded(input: LicenseEndedEmailInput): RenderedEmail {
  const tierName = LICENSE_TIER_NAMES[input.plan.tier];
  const subject = `Your OpenBot ${tierName} license has ended`;
  const ended =
    input.reason === "unpaid"
      ? "We could not take the payment for your OpenBot license, so it has ended."
      : "Your OpenBot license was canceled, and it has ended.";
  const preheader = ended;
  const data = "Your workspaces, chats, and files stay on your computer.";
  const again = "To use OpenBot for work again, buy a new license at any time.";
  const reply = "If this is a mistake, or you have a question, reply to this email.";
  const footer = "You receive this email because you had an OpenBot license.";
  const rows = licenseRows(input.plan, input.users);
  return {
    subject,
    preheader,
    text: textBody(
      [
        "Hi,",
        "",
        ended,
        "",
        ...rows.map(([label, value]) => `${label}: ${value}`),
        "",
        data,
        again,
        `See prices: ${PRICING_URL}`,
        "",
        reply,
        ...SIGNATURE_TEXT,
      ],
      footer,
    ),
    html: renderLayout({
      title: subject,
      preheader,
      body: [
        heading("Your license has ended", { gap: 16 }),
        paragraph("Hi,", { gap: 16 }),
        paragraph(escapeHtml(ended), { gap: 16 }),
        detailRows(rows),
        paragraph(`${escapeHtml(data)} ${escapeHtml(again)}`, { gap: 16 }),
        button("See prices", PRICING_URL),
        paragraph(reply, { gap: 24 }),
        SIGNATURE_HTML,
      ].join(""),
      footer,
    }),
  };
}

const SIGNATURE_TEXT = ["", "Best,", "Kamil"];
const SIGNATURE_HTML = paragraph("Best,<br>Kamil", { last: true });

function licenseRows(plan: LicensePlan, users: number): [label: string, value: string][] {
  return [
    ["License", `${LICENSE_TIER_NAMES[plan.tier]} license${plan.bundle ? " (bundle)" : ""}`],
    ["Seats", String(users)],
  ];
}

/** An amount in minor units, for example `€80.00`. */
function formatAmount(amount: number, currency: BillingCurrency): string {
  return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
}

/** A day in UTC, for example `2 Nov 2026`. */
function formatDate(time: number): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(time);
}

function textBody(lines: string[], footer: string): string {
  return [
    ...lines,
    "",
    footer,
    "",
    "-- ",
    `OpenBot · ${SITE_URL}`,
    FOOTER_LINKS.slice(1)
      .map((link) => `${link.label}: ${link.href}`)
      .join(" · "),
  ].join("\r\n");
}

interface LayoutInput {
  title: string;
  preheader: string;
  body: string;
  footer: string;
}

function renderLayout(input: LayoutInput): string {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<title>${escapeHtml(input.title)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>body, table, td, p, a, h1 { font-family: Arial, sans-serif !important; }</style>
<![endif]-->
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (max-width: 520px) {
    .ob-outer { padding: 28px 12px !important; }
    .ob-card { padding: 28px 22px !important; }
    .ob-code { font-size: 26px !important; letter-spacing: 4px !important; }
  }
  @media (prefers-color-scheme: dark) {
    body, .ob-page { background: #141414 !important; }
    .ob-card { background: #1f1f1f !important; border-color: #2e2e2e !important; }
    .ob-text, .ob-text strong { color: #f2f2f2 !important; }
    .ob-muted { color: #a3a3a3 !important; }
    .ob-faint, .ob-faint a { color: #7a7a7a !important; }
    .ob-code { background: #2a2433 !important; border-color: #3d3350 !important; color: #f2f2f2 !important; }
    .ob-rule { border-color: #2e2e2e !important; }
    .ob-button { background: #f2f2f2 !important; }
    .ob-button a { color: #141414 !important; }
  }
  [data-ogsc] .ob-text, [data-ogsc] .ob-text strong { color: #f2f2f2 !important; }
  [data-ogsc] .ob-muted { color: #a3a3a3 !important; }
  [data-ogsc] .ob-faint, [data-ogsc] .ob-faint a { color: #7a7a7a !important; }
  [data-ogsb] .ob-page { background: #141414 !important; }
  [data-ogsb] .ob-card { background: #1f1f1f !important; }
  [data-ogsb] .ob-code { background: #2a2433 !important; }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background:${COLOR.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;">${escapeHtml(input.preheader)}${PREHEADER_FILLER}</div>
<div role="article" aria-roledescription="email" aria-label="${escapeHtml(input.title)}" lang="en">
<table role="presentation" class="ob-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.page};">
  <tr>
    <td class="ob-outer" align="center" style="padding:48px 16px;">
      <!--[if mso]><table role="presentation" width="480" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;margin:0 auto;">
        <tr>
          <td style="padding:0 4px 20px;">
            <a href="${SITE_URL}" style="text-decoration:none;">
              <img src="${LOGO_URL}" width="32" height="32" alt="OpenBot" style="display:block;border:0;outline:none;border-radius:8px;font-family:${FONT_STACK};font-size:15px;font-weight:600;line-height:32px;color:${COLOR.text};">
            </a>
          </td>
        </tr>
        <tr>
          <td class="ob-card" style="background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:16px;padding:36px 36px 32px;font-family:${FONT_STACK};word-break:break-word;overflow-wrap:anywhere;">
            ${input.body}
          </td>
        </tr>
        <tr>
          <td class="ob-faint" style="padding:20px 4px 0;font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${COLOR.faint};">
            <p style="margin:0 0 12px;">${escapeHtml(input.footer)}</p>
            <p style="margin:0;">${footerLinks()}</p>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</div>
</body>
</html>`;
}

function footerLinks(): string {
  return FOOTER_LINKS.map(
    (link) =>
      `<a href="${link.href}" style="color:${COLOR.faint};text-decoration:underline;">${escapeHtml(link.label)}</a>`,
  ).join(`<span aria-hidden="true">&nbsp;&nbsp;·&nbsp;&nbsp;</span>`);
}

function heading(html: string, options: { gap?: number } = {}): string {
  return `<h1 class="ob-text" style="margin:0 0 ${options.gap ?? 10}px;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.2px;color:${COLOR.text};">${html}</h1>`;
}

function paragraph(html: string, options: { muted?: boolean; last?: boolean; gap?: number } = {}): string {
  const color = options.muted ? COLOR.muted : COLOR.text;
  const size = options.muted ? "13px;line-height:20px" : "15px;line-height:23px";
  return `<p class="${options.muted ? "ob-muted" : "ob-text"}" style="margin:0 0 ${options.last ? 0 : (options.gap ?? 20)}px;font-size:${size};color:${color};">${html}</p>`;
}

function codeBlock(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td class="ob-code" align="center" style="background:${COLOR.codeBg};border:1px solid ${COLOR.codeBorder};border-radius:12px;padding:20px 12px;font-family:${MONO_STACK};font-size:30px;line-height:36px;font-weight:600;letter-spacing:6px;color:${COLOR.text};-webkit-user-select:all;user-select:all;">${escapeHtml(code)}</td>
  </tr>
</table>`;
}

function detailRow(label: string, value: string): string {
  return detailRows([[label, value]]);
}

function detailRows(rows: [label: string, value: string][]): string {
  const cells = rows
    .map(
      ([label, value]) => `<tr>
    <td class="ob-rule ob-muted" style="border-bottom:1px solid ${COLOR.border};padding:12px 0;font-size:13px;line-height:20px;color:${COLOR.muted};">${escapeHtml(label)}</td>
    <td class="ob-rule ob-text" align="right" style="border-bottom:1px solid ${COLOR.border};padding:12px 0;font-size:13px;line-height:20px;font-weight:600;color:${COLOR.text};">${escapeHtml(value)}</td>
  </tr>`,
    )
    .join("");
  return `<table role="presentation" class="ob-rule" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-top:1px solid ${COLOR.border};">
  ${cells}
</table>`;
}

function button(label: string, url: string): string {
  const href = escapeHtml(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  <tr>
    <td class="ob-button" style="background:${COLOR.button};border-radius:999px;">
      <!--[if mso]><v:roundrect href="${href}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="50%" stroke="f" fillcolor="${COLOR.button}"><w:anchorlock/><center style="color:${COLOR.buttonText};font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">${escapeHtml(label)}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${href}" style="display:inline-block;padding:12px 24px;font-size:14px;line-height:20px;font-weight:600;color:${COLOR.buttonText};text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a><!--<![endif]-->
    </td>
  </tr>
</table>`;
}

function linkFallback(url: string): string {
  return `<p class="ob-faint" style="margin:0;font-size:12px;line-height:18px;color:${COLOR.faint};">Button not working? Paste this link into your browser:<br><a href="${escapeHtml(url)}" style="color:${COLOR.faint};word-break:break-all;">${escapeHtml(url)}</a></p>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
