import type { WebMessagingInstallPlatform } from "@openbot/contracts/web-messaging-install";
import type { AppTranslate } from "@openbot/i18n";
import { DOWNLOAD_PLATFORMS, type DownloadPlatform } from "../../lib/download-platforms";
import type { FailureKind } from "./MessagingConnectPage";

/*
 * The text of the pages that do one task, built from `sitePage.*` catalog keys. A route loader runs
 * these builders with `loadPageText`, and the components get plain strings as props. This module has
 * only a type import of the catalogs, so the components do not pull them into the browser bundle.
 */

const PROVIDER_NAMES: Record<WebMessagingInstallPlatform, string> = { slack: "Slack", discord: "Discord" };

/** Private-use characters that mark where the two links go in the "No app?" sentence. */
const JOIN_LINK_MARKERS = { browser: "", download: "" } as const;

export type JoinLink = keyof typeof JOIN_LINK_MARKERS;

/** Splits a sentence at each marker and keeps the markers as parts. */
const JOIN_LINK_SPLIT = new RegExp(`([${Object.values(JOIN_LINK_MARKERS).join("")}])`, "u");

/** One part of a sentence with links: plain text, or the text of the link that `link` names. */
export interface JoinTextPart {
  text: string;
  link?: JoinLink;
}

function joinTextParts(sentence: string, links: Record<JoinLink, string>): JoinTextPart[] {
  return sentence
    .split(JOIN_LINK_SPLIT)
    .filter((part) => part !== "")
    .map((part) => {
      if (part === JOIN_LINK_MARKERS.browser) return { text: links.browser, link: "browser" };
      if (part === JOIN_LINK_MARKERS.download) return { text: links.download, link: "download" };
      return { text: part };
    });
}

export function joinPageText(t: AppTranslate) {
  const open = t("sitePage.join.open");
  const links = { browser: t("sitePage.join.browserLink"), download: t("sitePage.join.downloadLink") };
  return {
    eyebrow: t("sitePage.join.eyebrow"),
    title: t("sitePage.join.title"),
    /** The page description and the link preview text. */
    description: t("sitePage.join.description"),
    intro: t("sitePage.join.intro"),
    invalid: t("sitePage.join.invalid"),
    open,
    noApp: joinTextParts(t("sitePage.join.noApp", JOIN_LINK_MARKERS), links),
    /** Phones get no download link: the desktop download does not install there. */
    noAppMobile: joinTextParts(t("sitePage.join.noAppMobile", { browser: JOIN_LINK_MARKERS.browser }), links),
    mobile: t("sitePage.join.mobile", { open }),
    email: t("sitePage.join.email"),
    openAppFallback: openAppFallbackText(t, t("sitePage.join.notOpened", { open })),
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
  /** The label of the download button, by platform. The page finds the visitor's platform. */
  const downloadFor = (id: DownloadPlatform) =>
    t("sitePage.marketplace.downloadFor", { platform: DOWNLOAD_PLATFORMS[id].label });
  const download: Record<DownloadPlatform, string> = {
    macos: downloadFor("macos"),
    windows: downloadFor("windows"),
    linux: downloadFor("linux"),
  };
  return { title: t("sitePage.openApp.title"), body, dismiss: t("sitePage.openApp.dismiss"), download };
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
