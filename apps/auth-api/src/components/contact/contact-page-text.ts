import type { AppTranslate } from "@openbot/i18n";
import { slot } from "../../lib/text-slots";

/*
 * The text of the /contact page, built from `sitePage.contact.*` catalog keys. The routes `/contact`,
 * `/pl/contact` and `/pt/contact` run `contactPageText` with `loadPageText`. This module has only a type import of the
 * catalogs, so the page does not pull them into the browser bundle.
 */

/** The text before and after the email address in `text`. */
function aroundEmail(text: string) {
  const [before = "", after = ""] = text.split(slot("email"));
  return { before, after };
}

export function contactPageText(t: AppTranslate) {
  const email = { email: slot("email") };
  return {
    title: t("sitePage.contact.title"),
    description: t("sitePage.contact.description"),
    imageAlt: t("sitePage.contact.imageAlt"),
    heading: t("sitePage.contact.heading"),
    intro: t("sitePage.contact.intro"),
    channels: {
      discord: t("sitePage.contact.channel.discord"),
      github: t("sitePage.contact.channel.github"),
      x: t("sitePage.contact.channel.x"),
    },
    fields: {
      name: t("sitePage.contact.name"),
      email: t("sitePage.contact.email"),
      company: t("sitePage.contact.company"),
      topic: t("sitePage.contact.topic"),
      message: t("sitePage.contact.message"),
    },
    optional: t("sitePage.contact.optional"),
    placeholder: t("sitePage.contact.placeholder"),
    errors: {
      email: t("sitePage.contact.emailInvalid"),
      message: t("sitePage.contact.messageEmpty"),
    },
    topics: {
      setup: t("sitePage.contact.topic.setup"),
      partnership: t("sitePage.contact.topic.partnership"),
      press: t("sitePage.contact.topic.press"),
      other: t("sitePage.contact.topic.other"),
    },
    send: t("sitePage.contact.send"),
    sending: t("sitePage.contact.sending"),
    privacy: t("sitePage.contact.privacy"),
    privacyLink: t("sitePage.contact.privacyLink"),
    limited: aroundEmail(t("sitePage.contact.limited", email)),
    failed: aroundEmail(t("sitePage.contact.failed", email)),
    sentTitle: t("sitePage.contact.sentTitle"),
    sentBody: aroundEmail(t("sitePage.contact.sentBody", email)),
    sendAnother: t("sitePage.contact.sendAnother"),
  };
}

export type ContactPageText = ReturnType<typeof contactPageText>;
