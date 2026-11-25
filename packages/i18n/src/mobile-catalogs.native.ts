import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { type AppMobileMessages, enMobile } from "./messages/en/mobile";

export function mobileCatalog(locale: TranslatedLocale): PartialTranslation<AppMobileMessages> {
  switch (locale) {
    case "en":
      return enMobile;
    case "de": {
      const catalog: typeof import("./messages/de/mobile") = require("./messages/de/mobile");
      return catalog.deMobile;
    }
    case "es": {
      const catalog: typeof import("./messages/es/mobile") = require("./messages/es/mobile");
      return catalog.esMobile;
    }
    case "ar": {
      const catalog: typeof import("./messages/ar/mobile") = require("./messages/ar/mobile");
      return catalog.arMobile;
    }
    case "fr": {
      const catalog: typeof import("./messages/fr/mobile") = require("./messages/fr/mobile");
      return catalog.frMobile;
    }
    case "he": {
      const catalog: typeof import("./messages/he/mobile") = require("./messages/he/mobile");
      return catalog.heMobile;
    }
    case "it": {
      const catalog: typeof import("./messages/it/mobile") = require("./messages/it/mobile");
      return catalog.itMobile;
    }
    case "ja": {
      const catalog: typeof import("./messages/ja/mobile") = require("./messages/ja/mobile");
      return catalog.jaMobile;
    }
    case "ko": {
      const catalog: typeof import("./messages/ko/mobile") = require("./messages/ko/mobile");
      return catalog.koMobile;
    }
    case "nl": {
      const catalog: typeof import("./messages/nl/mobile") = require("./messages/nl/mobile");
      return catalog.nlMobile;
    }
    case "pl": {
      const catalog: typeof import("./messages/pl/mobile") = require("./messages/pl/mobile");
      return catalog.plMobile;
    }
    case "pt": {
      const catalog: typeof import("./messages/pt/mobile") = require("./messages/pt/mobile");
      return catalog.ptMobile;
    }
    case "ru": {
      const catalog: typeof import("./messages/ru/mobile") = require("./messages/ru/mobile");
      return catalog.ruMobile;
    }
    case "tr": {
      const catalog: typeof import("./messages/tr/mobile") = require("./messages/tr/mobile");
      return catalog.trMobile;
    }
    case "zh": {
      const catalog: typeof import("./messages/zh/mobile") = require("./messages/zh/mobile");
      return catalog.zhMobile;
    }
  }
}
