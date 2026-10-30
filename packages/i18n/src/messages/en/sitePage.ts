import { defineMessages } from "../../message";

/**
 * The public web pages that do one task: join a server, return from Slack or Discord, return from
 * billing, report a hosted site, and the load error page. `apps/auth-api` renders
 * them on the server in the visitor's language.
 */
export const messages = defineMessages("sitePage", {
  "sitePage.error.title": "This page could not load",
  "sitePage.error.body":
    "Check your connection and reload the page. If it still does not load, go back to the home page.",
  "sitePage.error.reload": "Reload page",
  "sitePage.error.home": "Back to home",
  "sitePage.join.title": "Join an OpenBot server",
  "sitePage.join.description": "Open a private server invitation in OpenBot.",
  "sitePage.join.eyebrow": "Private invitation",
  "sitePage.join.intro":
    "Open this invitation in OpenBot. The app checks the server and asks you to confirm before it connects.",
  "sitePage.join.invalid":
    "This invitation link is not valid or is not complete. Ask the server owner for a new invitation.",
  "sitePage.join.open": "Open OpenBot",
  "sitePage.join.browser": "Open in browser",
  "sitePage.join.download": "Download OpenBot",
  // {download} and {browser} are the labels of the two buttons above this note.
  "sitePage.join.notOpened":
    "If OpenBot did not open, install it with {download}, or start OpenBot once so that it can open invitation links. You can also use {browser}.",
  // {open} is the label of the button above this note.
  "sitePage.join.mobile":
    "If OpenBot is installed, tap {open}. You can also paste this link into Add server in the app.",
  "sitePage.join.singleUse":
    "A single-use link works one time and then expires. A permanent link works until the owner revokes it. OpenBot shows the expiry before you join.",
  "sitePage.join.email": "If the invitation came by email, sign in to OpenBot with that email address.",
  "sitePage.join.share": "This link gives access to a server. Share it only with people you want to invite.",
  // {name} is Slack or Discord on all the connect keys.
  "sitePage.connect.title": "Return to OpenBot",
  "sitePage.connect.failedTitle": "The connection did not finish",
  "sitePage.connect.openApp": "Open OpenBot",
  "sitePage.connect.tryAgainApp": "Try again in OpenBot",
  "sitePage.connect.tryAgainBrowser": "Try again in browser",
  "sitePage.connect.doneInWebClient": "Your OpenBot tab finishes the {name} connection. You can close this tab.",
  "sitePage.connect.doneInApp": "OpenBot finishes the {name} connection on your computer.",
  "sitePage.connect.failure.cancelled": "The {name} connection was cancelled. Nothing changed.",
  "sitePage.connect.failure.expired": "The {name} sign-in expired. Start the connection again.",
  "sitePage.connect.failure.exchange": "{name} did not confirm the connection. Try again.",
  "sitePage.connect.failure.enterprise": "Connect one Slack workspace, not a whole organization.",
  "sitePage.connect.failure.takenSlack":
    "Another OpenBot server already answers this Slack workspace. Disconnect it on that server, then try again.",
  "sitePage.connect.failure.takenDiscord":
    "Another OpenBot server already answers this Discord server. Disconnect it on that server, then try again.",
  "sitePage.connect.failure.unavailable": "OpenBot cannot connect to {name} now. Try again later.",
  "sitePage.connect.failure.tabClosed":
    "The OpenBot tab that started the {name} connection did not answer. Open OpenBot in your browser and connect {name} again.",
  "sitePage.connect.failure.failed": "{name} did not finish the connection. Try again.",
  // {marketplace}, {apps} and {connect} are the names of these screens and that button in the app.
  "sitePage.connect.restartHint": "In OpenBot, open {marketplace}, then {apps}, then {name}, and select {connect}.",
  "sitePage.connect.notOpened":
    "Start OpenBot, then try again. If OpenBot is not on this computer, download it and connect {name} from the app.",
  "sitePage.openApp.title": "Nothing opened?",
  "sitePage.openApp.dismiss": "Not now",
  "sitePage.billing.pageTitle": "OpenBot billing",
  "sitePage.billing.updatedTitle": "Billing updated",
  "sitePage.billing.updatedBody": "Go back to OpenBot. You can close this page.",
  "sitePage.billing.cancelledTitle": "Checkout cancelled",
  "sitePage.billing.cancelledBody": "Nothing was charged. Go back to OpenBot.",
  "sitePage.report.pageTitle": "Report a hosted site — OpenBot",
  "sitePage.report.title": "Report a hosted site",
  "sitePage.report.intro": "Send a report about harmful or unlawful content on an openbot.site address.",
  "sitePage.report.hostnameLabel": "Site address",
  "sitePage.report.hostnameMissing": "Enter the site address",
  "sitePage.report.reasonLabel": "Reason",
  "sitePage.report.reason.phishing": "Phishing",
  "sitePage.report.reason.malware": "Malware",
  "sitePage.report.reason.abuse": "Abuse",
  "sitePage.report.reason.copyright": "Copyright",
  "sitePage.report.reason.other": "Other",
  "sitePage.report.detailsLabel": "Details",
  "sitePage.report.optional": "Optional",
  "sitePage.report.detailsPlaceholder": "What is wrong with this site?",
  "sitePage.report.send": "Send report",
  "sitePage.report.sending": "Sending…",
  "sitePage.report.tooMany": "Too many reports. Try again later.",
  "sitePage.report.sendFailed": "Could not send the report. Try again.",
  // {email} is the contact address. The page shows it as a link.
  "sitePage.report.writeTo": "You can also write to {email}.",
  "sitePage.report.sentTitle": "Report sent",
  "sitePage.report.sentBody": "Thanks. We received your report.",
  "sitePage.report.home": "Go to the home page",
  "sitePage.pricing.title": "OpenBot pricing",
  "sitePage.pricing.description":
    "Hosted servers and a license for teams. OpenBot is free for personal use on your own computer.",
  "sitePage.pricing.heading": "Pricing",
  "sitePage.pricing.enterprise.title": "Enterprise",
  // {count} is the largest number of members that the page sells, such as 25.
  "sitePage.pricing.enterprise.body":
    "Larger servers, more than {count} members, or anything else you need. With enterprise support.",
  "sitePage.pricing.enterprise.contact": "Contact sales",
});
