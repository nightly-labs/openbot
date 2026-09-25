import { OPENBOT_LINKS } from "../lib/landing-links";

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

const SITE_URL = "https://openbot.run";
const LOGO_URL = `${SITE_URL}/icon-192x192.png`;
const FOOTER_LINKS = [
  { label: "openbot.run", href: SITE_URL },
  { label: "X", href: OPENBOT_LINKS.contact },
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

function heading(html: string): string {
  return `<h1 class="ob-text" style="margin:0 0 10px;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.2px;color:${COLOR.text};">${html}</h1>`;
}

function paragraph(html: string, options: { muted?: boolean; last?: boolean } = {}): string {
  const color = options.muted ? COLOR.muted : COLOR.text;
  const size = options.muted ? "13px;line-height:20px" : "15px;line-height:23px";
  return `<p class="${options.muted ? "ob-muted" : "ob-text"}" style="margin:0 0 ${options.last ? 0 : 20}px;font-size:${size};color:${color};">${html}</p>`;
}

function codeBlock(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td class="ob-code" align="center" style="background:${COLOR.codeBg};border:1px solid ${COLOR.codeBorder};border-radius:12px;padding:20px 12px;font-family:${MONO_STACK};font-size:30px;line-height:36px;font-weight:600;letter-spacing:6px;color:${COLOR.text};-webkit-user-select:all;user-select:all;">${escapeHtml(code)}</td>
  </tr>
</table>`;
}

function detailRow(label: string, value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  <tr>
    <td class="ob-rule ob-muted" style="border-top:1px solid ${COLOR.border};border-bottom:1px solid ${COLOR.border};padding:12px 0;font-size:13px;line-height:20px;color:${COLOR.muted};">${escapeHtml(label)}</td>
    <td class="ob-rule ob-text" align="right" style="border-top:1px solid ${COLOR.border};border-bottom:1px solid ${COLOR.border};padding:12px 0;font-size:13px;line-height:20px;font-weight:600;color:${COLOR.text};">${escapeHtml(value)}</td>
  </tr>
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
