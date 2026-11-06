import type { ProviderLogoVariant } from "@openbot/brand";
import type { AppTranslate } from "@openbot/i18n";
import { DOWNLOAD_PLATFORMS, type DownloadPlatform } from "./download-platforms";
import { ADA, CLAUDE_CODE, type LandingFeatureId, type LandingTeamsOfferId, LINUS } from "./landing-content";
import type { LandingQuestion } from "./landing-faq";
import { OPENBOT_LINKS } from "./landing-links";
import type { MobilePlatform } from "./mobile-apps";
import { slot, slotted } from "./text-slots";

/*
 * The text of the home page, built from `sitePage.landing.*` catalog keys. The route loaders of `/`
 * and `/pl` run `landingPageText` with `loadPageText`, and the sections read plain strings through
 * `useLandingText`. This module has only a type import of the catalogs, so the sections do not pull
 * them into the browser bundle.
 */

/** A provider name with its logo in the hero sentence. `suffix` is the punctuation that stays on its line. */
export interface HeroProviderPart {
  provider: ProviderLogoVariant;
  name: string;
  suffix: string;
}

/** Words of a feature sentence that link to a page under /providers. */
interface FeatureLinkPart {
  text: string;
  slug: string;
}

export type FeatureDescriptionPart = string | FeatureLinkPart;

const HERO_PROVIDERS: Readonly<Record<string, Omit<HeroProviderPart, "suffix">>> = {
  codex: { provider: "codex", name: "Codex" },
  claude: { provider: "claude", name: "Claude" },
  gemini: { provider: "antigravity", name: "Gemini" },
  grok: { provider: "grok", name: "Grok" },
};

/** Punctuation that follows a provider name. It stays with the name, so a line does not start with it. */
const LEADING_PUNCTUATION = /^[,.;:]/;

function heroDescription(t: AppTranslate): (string | HeroProviderPart)[] {
  const text = t("sitePage.landing.hero.description", {
    codex: slot("codex"),
    claude: slot("claude"),
    gemini: slot("gemini"),
    grok: slot("grok"),
  });
  const parts: (string | HeroProviderPart)[] = [];
  for (const part of slotted(text, HERO_PROVIDERS)) {
    const previous = parts.at(-1);
    const punctuation = typeof part === "string" ? LEADING_PUNCTUATION.exec(part)?.[0] : undefined;
    if (typeof part === "string" && punctuation && previous && typeof previous !== "string") {
      previous.suffix = punctuation;
      const rest = part.slice(punctuation.length);
      if (rest) parts.push(rest);
    } else {
      parts.push(typeof part === "string" ? part : { ...part, suffix: "" });
    }
  }
  return parts;
}

function providersDescription(t: AppTranslate): FeatureDescriptionPart[] {
  const text = t("sitePage.landing.features.providers.description", {
    codex: slot("codex"),
    claudeCode: slot("claudeCode"),
    gemini: slot("gemini"),
    grok: slot("grok"),
    opencode: slot("opencode"),
    cursor: slot("cursor"),
    cline: slot("cline"),
    museCode: slot("museCode"),
    pi: slot("pi"),
    mercury: slot("mercury"),
    acp: slot("acp"),
    local: slot("local"),
  });
  return slotted<FeatureLinkPart>(text, {
    codex: { text: "Codex", slug: "codex" },
    claudeCode: { text: "Claude Code", slug: "claude-code" },
    gemini: { text: "Gemini", slug: "gemini" },
    grok: { text: "Grok", slug: "grok" },
    opencode: { text: "OpenCode", slug: "opencode" },
    cursor: { text: "Cursor", slug: "cursor" },
    cline: { text: "Cline", slug: "cline" },
    museCode: { text: "Muse Code", slug: "muse-code" },
    pi: { text: "Pi", slug: "pi" },
    mercury: { text: "Mercury", slug: "inception" },
    acp: { text: t("sitePage.landing.features.providers.acpLink"), slug: "custom-agents" },
    local: { text: t("sitePage.landing.features.providers.localLink"), slug: "local-models" },
  });
}

/** One line of the list on each row. */
const lines = (text: string) => text.split("\n").filter((line) => line.trim() !== "");

function questions(t: AppTranslate): LandingQuestion[] {
  return [
    { question: t("sitePage.landing.faq.free.question"), answer: t("sitePage.landing.faq.free.answer") },
    {
      question: t("sitePage.landing.faq.source.question"),
      answer: t("sitePage.landing.faq.source.answer"),
      link: { label: t("sitePage.landing.faq.source.link"), href: OPENBOT_LINKS.repository },
    },
    { question: t("sitePage.landing.faq.plans.question"), answer: t("sitePage.landing.faq.plans.answer") },
    { question: t("sitePage.landing.faq.models.question"), answer: t("sitePage.landing.faq.models.answer") },
    { question: t("sitePage.landing.faq.limit.question"), answer: t("sitePage.landing.faq.limit.answer") },
    { question: t("sitePage.landing.faq.start.question"), answer: t("sitePage.landing.faq.start.answer") },
    { question: t("sitePage.landing.faq.data.question"), answer: t("sitePage.landing.faq.data.answer") },
    { question: t("sitePage.landing.faq.computers.question"), answer: t("sitePage.landing.faq.computers.answer") },
    { question: t("sitePage.landing.faq.safety.question"), answer: t("sitePage.landing.faq.safety.answer") },
  ];
}

export function landingPageText(t: AppTranslate) {
  const [titleBefore = "", titleAfter = ""] = t("sitePage.landing.hero.title", { name: slot("name") })
    .split(slot("name"))
    .map((part) => part.trim());
  const channel = t("sitePage.landing.picture.channel");
  const downloadFor = (platform: DownloadPlatform) =>
    t("sitePage.marketplace.downloadFor", { platform: DOWNLOAD_PLATFORMS[platform].label });
  const features: Record<LandingFeatureId, { title: string; description: FeatureDescriptionPart[] }> = {
    team: {
      title: t("sitePage.landing.features.team.title"),
      description: [t("sitePage.landing.features.team.description")],
    },
    providers: { title: t("sitePage.landing.features.providers.title"), description: providersDescription(t) },
    local: {
      title: t("sitePage.landing.features.local.title"),
      description: [t("sitePage.landing.features.local.description")],
    },
    multiplayer: {
      title: t("sitePage.landing.features.multiplayer.title"),
      description: [t("sitePage.landing.features.multiplayer.description")],
    },
    workflows: {
      title: t("sitePage.landing.features.workflows.title"),
      description: [t("sitePage.landing.features.workflows.description")],
    },
    persist: {
      title: t("sitePage.landing.features.persist.title"),
      description: [t("sitePage.landing.features.persist.description")],
    },
  };
  const offers: Record<LandingTeamsOfferId, { label: string; title: string; description: string }> = {
    servers: {
      label: t("sitePage.landing.teams.servers.label"),
      title: t("sitePage.landing.teams.servers.title"),
      description: t("sitePage.landing.teams.servers.description"),
    },
    environments: {
      label: t("sitePage.landing.teams.environments.label"),
      title: t("sitePage.landing.teams.environments.title"),
      description: t("sitePage.landing.teams.environments.description"),
    },
    integrations: {
      label: t("sitePage.landing.teams.integrations.label"),
      title: t("sitePage.landing.teams.integrations.title"),
      description: t("sitePage.landing.teams.integrations.description"),
    },
    support: {
      label: t("sitePage.landing.teams.support.label"),
      title: t("sitePage.landing.teams.support.title"),
      description: t("sitePage.landing.teams.support.description"),
    },
  };
  const phone: Record<MobilePlatform, { description: string; action: string }> = {
    ios: {
      description: t("sitePage.landing.download.phoneDescription", { store: "App Store" }),
      action: t("sitePage.landing.download.appStore"),
    },
    android: {
      description: t("sitePage.landing.download.phoneDescription", { store: "Google Play" }),
      action: t("sitePage.landing.download.googlePlay"),
    },
  };

  return {
    title: t("sitePage.landing.title"),
    description: t("sitePage.landing.description"),
    hero: {
      new: t("sitePage.landing.hero.new"),
      availableOn: t("sitePage.landing.hero.availableOn"),
      title: { before: titleBefore, after: titleAfter },
      description: heroDescription(t),
      contact: t("sitePage.landing.hero.contact"),
      choosePlatform: t("sitePage.landing.hero.choosePlatform"),
      platforms: t("sitePage.landing.hero.platforms"),
      phoneApps: t("sitePage.landing.hero.phoneApps"),
    },
    preview: {
      title: t("sitePage.landing.preview.title"),
      loading: t("sitePage.landing.preview.loading"),
    },
    network: {
      /** The words appear one at a time. */
      title: t("sitePage.landing.network.title").split(/\s+/).filter(Boolean),
      description: t("sitePage.landing.network.description"),
      eggs: {
        greetings: lines(t("sitePage.landing.network.eggs.greetings")),
        konami: lines(t("sitePage.landing.network.eggs.konami")),
        party: lines(t("sitePage.landing.network.eggs.party")),
        sudo: lines(t("sitePage.landing.network.eggs.sudo")),
        tickle: lines(t("sitePage.landing.network.eggs.tickle")),
        awake: lines(t("sitePage.landing.network.eggs.awake")),
        busy: lines(t("sitePage.landing.network.eggs.busy")),
        wonder: lines(t("sitePage.landing.network.eggs.wonder")),
        sneeze: lines(t("sitePage.landing.network.eggs.sneeze")),
        blessings: lines(t("sitePage.landing.network.eggs.blessings")),
        wake: lines(t("sitePage.landing.network.eggs.wake")),
        chats: lines(t("sitePage.landing.network.eggs.chats")),
        hover: lines(t("sitePage.landing.network.eggs.hover")),
      },
    },
    features: {
      title: t("sitePage.landing.features.title"),
      description: t("sitePage.landing.features.description"),
      items: features,
    },
    picture: {
      channel,
      team: {
        /** In the order of `LANDING_TEAM_SENDERS`. */
        messages: [
          t("sitePage.landing.picture.team.first"),
          t("sitePage.landing.picture.team.second"),
          t("sitePage.landing.picture.team.third"),
        ],
        reply: t("sitePage.landing.picture.team.reply"),
        handoff: t("sitePage.landing.picture.team.handoff", { from: ADA.name, to: LINUS.name }),
      },
      multiplayer: {
        /** In the order of `LANDING_MULTIPLAYER_SENDERS`. */
        messages: [
          t("sitePage.landing.picture.multiplayer.first"),
          t("sitePage.landing.picture.multiplayer.second"),
          t("sitePage.landing.picture.multiplayer.third"),
        ],
        invite: t("sitePage.landing.picture.multiplayer.invite"),
      },
      workflows: {
        trigger: t("sitePage.landing.picture.workflows.trigger"),
        schedule: t("sitePage.landing.picture.workflows.schedule"),
        issues: t("sitePage.landing.picture.workflows.issues"),
        usage: t("sitePage.landing.picture.workflows.usage"),
        report: t("sitePage.landing.picture.workflows.report"),
        charts: t("sitePage.landing.picture.workflows.charts"),
        approval: t("sitePage.landing.picture.workflows.approval"),
        question: t("sitePage.landing.picture.workflows.question"),
        approve: t("sitePage.landing.picture.workflows.approve"),
        approved: t("sitePage.landing.picture.workflows.approved"),
      },
      persist: {
        earlier: t("sitePage.landing.picture.persist.earlier"),
        request: t("sitePage.landing.picture.persist.request"),
        before: t("sitePage.landing.picture.persist.before"),
        switch: t("sitePage.landing.picture.persist.switch", {
          agent: ADA.name,
          provider: CLAUDE_CODE.name,
        }),
        after: t("sitePage.landing.picture.persist.after"),
      },
      local: {
        title: t("sitePage.landing.picture.local.title"),
        items: [
          t("sitePage.landing.picture.local.workspaces"),
          t("sitePage.landing.picture.local.conversations"),
          t("sitePage.landing.picture.local.files"),
          t("sitePage.landing.picture.local.browserData"),
        ],
      },
    },
    pricing: {
      title: t("sitePage.landing.pricing.title"),
      facts: [
        t("sitePage.landing.pricing.everyFeature"),
        t("sitePage.landing.pricing.yourComputer"),
        t("sitePage.landing.pricing.yourPlans"),
      ],
      download: t("sitePage.landing.pricing.download"),
      license: t("sitePage.landing.pricing.license"),
    },
    teams: {
      title: t("sitePage.landing.teams.title"),
      statement: t("sitePage.landing.teams.statement"),
      description: t("sitePage.landing.teams.description"),
      contact: t("sitePage.landing.teams.contact"),
      learn: t("sitePage.landing.teams.learn"),
      offers,
    },
    faq: {
      title: t("sitePage.landing.faq.title"),
      description: t("sitePage.landing.faq.description"),
      contact: t("sitePage.landing.faq.contact"),
      questions: questions(t),
      compare: t("sitePage.landing.faq.compare"),
    },
    download: {
      title: t("sitePage.landing.download.title"),
      description: t("sitePage.landing.download.description"),
      available: t("sitePage.landing.download.available"),
      desktop: {
        macos: downloadFor("macos"),
        windows: downloadFor("windows"),
        linux: downloadFor("linux"),
      } satisfies Record<DownloadPlatform, string>,
      phone,
      pages: t("sitePage.landing.download.pages"),
    },
  };
}

export type LandingPageText = ReturnType<typeof landingPageText>;
