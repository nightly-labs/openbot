import type { WebMessagingInstallPlatform } from "@openbot/contracts/web-messaging-install";
import type { AppTranslate } from "@openbot/i18n";
import type { FailureKind } from "./MessagingConnectPage";

/*
 * The text of the pages that do one task, built from `sitePage.*` catalog keys. A route loader runs
 * these builders with `loadPageText`, and the components get plain strings as props. This module has
 * only a type import of the catalogs, so the components do not pull them into the browser bundle.
 */

const PROVIDER_NAMES: Record<WebMessagingInstallPlatform, string> = { slack: "Slack", discord: "Discord" };

export function joinPageText(t: AppTranslate) {
  const open = t("sitePage.join.open");
  const browser = t("sitePage.join.browser");
  const download = t("sitePage.join.download");
  return {
    eyebrow: t("sitePage.join.eyebrow"),
    title: t("sitePage.join.title"),
    /** The page description and the link preview text. */
    description: t("sitePage.join.description"),
    intro: t("sitePage.join.intro"),
    invalid: t("sitePage.join.invalid"),
    open,
    browser,
    download,
    notOpened: t("sitePage.join.notOpened", { download, browser }),
    mobile: t("sitePage.join.mobile", { open }),
    // The link carries no expiry, use limit or email, and the page does not send the token anywhere to
    // ask. So these notes give the rules, and the app shows the details before the visitor joins.
    singleUse: t("sitePage.join.singleUse"),
    email: t("sitePage.join.email"),
    share: t("sitePage.join.share"),
  };
}

export type JoinPageText = ReturnType<typeof joinPageText>;

export function messagingConnectText(t: AppTranslate, platform: WebMessagingInstallPlatform) {
  const name = PROVIDER_NAMES[platform];
  const connect = platform === "slack" ? t("connector.slack.connect") : t("connector.discord.connect");
  return {
    name,
    title: t("sitePage.connect.title"),
    failedTitle: t("sitePage.connect.failedTitle"),
    openApp: t("sitePage.connect.openApp"),
    tryAgainApp: t("sitePage.connect.tryAgainApp"),
    tryAgainBrowser: t("sitePage.connect.tryAgainBrowser"),
    doneInWebClient: t("sitePage.connect.doneInWebClient", { name }),
    doneInApp: t("sitePage.connect.doneInApp", { name }),
    failure: {
      cancelled: t("sitePage.connect.failure.cancelled", { name }),
      expired: t("sitePage.connect.failure.expired", { name }),
      exchange: t("sitePage.connect.failure.exchange", { name }),
      enterprise: t("sitePage.connect.failure.enterprise"),
      taken:
        platform === "slack" ? t("sitePage.connect.failure.takenSlack") : t("sitePage.connect.failure.takenDiscord"),
      unavailable: t("sitePage.connect.failure.unavailable", { name }),
      tabClosed: t("sitePage.connect.failure.tabClosed", { name }),
      failed: t("sitePage.connect.failure.failed", { name }),
    } satisfies Record<FailureKind, string>,
    restartHint: t("sitePage.connect.restartHint", {
      marketplace: t("marketplace.title"),
      apps: t("marketplace.tab.apps"),
      name,
      connect,
    }),
    openAppFallback: openAppFallbackText(t, t("sitePage.connect.notOpened", { name })),
  };
}

export type MessagingConnectText = ReturnType<typeof messagingConnectText>;

/** The "Nothing opened?" dialog. `body` says what to do on this page. */
function openAppFallbackText(t: AppTranslate, body: string) {
  return { title: t("sitePage.openApp.title"), body, dismiss: t("sitePage.openApp.dismiss") };
}

export type OpenAppFallbackText = ReturnType<typeof openAppFallbackText>;

export function billingReturnText(t: AppTranslate) {
  return {
    pageTitle: t("sitePage.billing.pageTitle"),
    updatedTitle: t("sitePage.billing.updatedTitle"),
    updatedBody: t("sitePage.billing.updatedBody"),
    cancelledTitle: t("sitePage.billing.cancelledTitle"),
    cancelledBody: t("sitePage.billing.cancelledBody"),
  };
}

/** A private-use character that marks where the contact link goes in `writeTo`. */
const EMAIL_MARKER = "";

export function reportSiteText(t: AppTranslate) {
  const [writeToBefore = "", writeToAfter = ""] = t("sitePage.report.writeTo", { email: EMAIL_MARKER }).split(
    EMAIL_MARKER,
  );
  return {
    pageTitle: t("sitePage.report.pageTitle"),
    title: t("sitePage.report.title"),
    intro: t("sitePage.report.intro"),
    hostnameLabel: t("sitePage.report.hostnameLabel"),
    hostnameMissing: t("sitePage.report.hostnameMissing"),
    reasonLabel: t("sitePage.report.reasonLabel"),
    /** The labels of the reasons that `/v1/sites/reports` accepts, by reason ID. */
    reasons: {
      phishing: t("sitePage.report.reason.phishing"),
      malware: t("sitePage.report.reason.malware"),
      abuse: t("sitePage.report.reason.abuse"),
      copyright: t("sitePage.report.reason.copyright"),
      other: t("sitePage.report.reason.other"),
    },
    detailsLabel: t("sitePage.report.detailsLabel"),
    optional: t("sitePage.report.optional"),
    detailsPlaceholder: t("sitePage.report.detailsPlaceholder"),
    send: t("sitePage.report.send"),
    sending: t("sitePage.report.sending"),
    tooMany: t("sitePage.report.tooMany"),
    sendFailed: t("sitePage.report.sendFailed"),
    /** The sentence around the contact link: the text before the link and the text after it. */
    writeTo: { before: writeToBefore, after: writeToAfter },
    sentTitle: t("sitePage.report.sentTitle"),
    sentBody: t("sitePage.report.sentBody"),
    home: t("sitePage.report.home"),
  };
}

export type ReportSiteText = ReturnType<typeof reportSiteText>;

function pageErrorText(t: AppTranslate) {
  return {
    title: t("sitePage.error.title"),
    body: t("sitePage.error.body"),
    reload: t("sitePage.error.reload"),
    home: t("sitePage.error.home"),
  };
}

export type PageErrorText = ReturnType<typeof pageErrorText>;

/** The text that the root route owns: the load error page. */
export function rootPageText(t: AppTranslate) {
  return { error: pageErrorText(t) };
}

export type RootPageText = ReturnType<typeof rootPageText>;
