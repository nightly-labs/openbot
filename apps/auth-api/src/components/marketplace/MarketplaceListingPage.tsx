import type { MarketplaceAgentSkill, MarketplaceSkillSummary } from "@openbot/contracts/ipc";
import type { SkillCategory } from "@openbot/contracts/ipc-skills";
import {
  createOpenBotMarketplaceUrl,
  createWebAppMarketplacePath,
  type MarketplaceListingLink,
} from "@openbot/contracts/marketplace-links";
import type { AppTranslate, TranslatedLocale } from "@openbot/i18n";
import { routineScheduleSummary } from "@openbot/ui/features/conversation/routine-schedule-ui";
import { CATEGORY_LABELS } from "@openbot/ui/features/marketplace/marketplace-listing";
import { type TextValue, useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import type { MarketplaceAgentListing, MarketplaceRoutineView, MarketplaceSkillView } from "../../lib/marketplace";
import { MARKETPLACE_ROUTE, MARKETPLACE_SKILLS_ROUTE } from "../../lib/marketplace-routes";
import { LandingIcon } from "../landing/LandingIcon";
import { PluginOpenButtons, type PluginOpenButtonsText } from "../plugins/PluginOpenButtons";
import { AgentMark, CopyLinkButton, ListingLink, MarketplaceFrame, SkillIcon, VerifiedMark } from "./MarketplaceParts";

/**
 * How far OpenBot checked a listing. Every listing in a list was reviewed before it went live; an
 * agent that waits for its first review is reached only through the link its creator shared.
 */
type Trust = "verified" | "reviewed" | "pending";

/**
 * A row on a listing page, drawn as the index draws one but without Add: a skill comes with its
 * agent, and a routine with its agent. With a link, the whole row opens it.
 */
function DetailRow(props: {
  name: string;
  verified?: boolean;
  line: string;
  link?: MarketplaceListingLink | undefined;
  children: JSX.Element;
}) {
  const body = () => (
    <>
      <span class="marketplace-site-row-mark">{props.children}</span>
      <span class="marketplace-site-row-text">
        <span class="marketplace-site-row-title">
          <span class="marketplace-site-name">
            {props.name}
            <VerifiedMark verified={props.verified === true} />
          </span>
        </span>
        <span class="marketplace-site-row-line">{props.line}</span>
      </span>
    </>
  );
  return (
    <li>
      <Show when={props.link}>
        {(link) => (
          <ListingLink link={link()} class="marketplace-site-row">
            {body()}
          </ListingLink>
        )}
      </Show>
      <Show when={props.link === undefined}>
        <div class="marketplace-site-row">{body()}</div>
      </Show>
    </li>
  );
}

/** A heading over the rows of one listing page, in one column. */
function DetailGroup(props: { id: string; title: string; children: JSX.Element }) {
  return (
    <section class="marketplace-site-group" aria-labelledby={props.id}>
      <div class="marketplace-site-group-head">
        <h2 class="marketplace-site-group-title" id={props.id}>
          {props.title}
        </h2>
      </div>
      <ul class="marketplace-site-rows marketplace-site-detail-rows">{props.children}</ul>
    </section>
  );
}

interface Fact {
  label: string;
  value: string;
}

/** The facts beside the rows on a wide screen, and under them on a narrow one. */
function Information(props: { facts: readonly Fact[] }) {
  const { t } = useText();
  return (
    <aside class="marketplace-site-detail-aside" aria-labelledby="marketplace-information-title">
      <div class="marketplace-site-group-head">
        <h2 class="marketplace-site-group-title" id="marketplace-information-title">
          {t("sitePage.marketplace.information")}
        </h2>
      </div>
      <dl class="plugin-facts marketplace-site-facts">
        <For each={props.facts}>
          {(fact) => (
            <div class="plugin-fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          )}
        </For>
      </dl>
    </aside>
  );
}

/**
 * The line before Add: who checked the listing, and what adding it allows. A verified listing has
 * none: the shield after its name says it, and a line under it would say it again.
 */
function TrustLine(props: { trust: Trust; text: string }) {
  return (
    <Show when={props.trust !== "verified"}>
      <p class="marketplace-site-trust">
        <Show when={props.trust === "reviewed"}>
          <LandingIcon name="users" />
        </Show>
        <Show when={props.trust === "pending"}>
          <LandingIcon name="clock" />
        </Show>
        {props.text}
      </p>
    </Show>
  );
}

function sourceLabel(t: AppTranslate, trust: Trust): string {
  if (trust === "verified") return t("sitePage.marketplace.source.verified");
  if (trust === "pending") return t("sitePage.marketplace.source.pending");
  return t("sitePage.marketplace.source.reviewed");
}

/** The facts that every listing has. The category is optional on an agent. */
function listingFacts(
  text: TextValue,
  listing: { creatorName: string; version: number; updatedAt: string; category?: SkillCategory | undefined },
  trust: Trust,
): Fact[] {
  const { t, format } = text;
  const category = listing.category;
  return [
    { label: t("sitePage.marketplace.fact.creator"), value: listing.creatorName },
    { label: t("sitePage.marketplace.fact.source"), value: sourceLabel(t, trust) },
    ...(category ? [{ label: t("sitePage.marketplace.fact.category"), value: t(CATEGORY_LABELS[category]) }] : []),
    { label: t("sitePage.marketplace.fact.version"), value: format.number(listing.version) },
    {
      label: t("sitePage.marketplace.fact.updated"),
      value: format.date(new Date(listing.updatedAt), {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    },
  ];
}

/**
 * Add to OpenBot opens the app at the listing, which shows what it brings and asks before it adds
 * anything; the browser button opens the web app at the same place. Both links come from the shared
 * helpers, never from listing data.
 */
function ListingActions(props: { link: MarketplaceListingLink; name: string }) {
  const { t } = useText();
  const buttonText = (): PluginOpenButtonsText => ({
    browser: t("sitePage.join.browser"),
    notOpened: t("sitePage.openApp.title"),
    dismiss: t("sitePage.openApp.dismiss"),
    download: (platform) => t("sitePage.marketplace.downloadFor", { platform }),
  });
  return (
    <div class="marketplace-site-actions">
      <PluginOpenButtons
        href={createOpenBotMarketplaceUrl(props.link)}
        browserHref={createWebAppMarketplacePath(props.link)}
        label={t("sitePage.marketplace.addToOpenBot")}
        downloadCopy={t("sitePage.marketplace.addFromApp", { name: props.name })}
        text={buttonText()}
      />
      <CopyLinkButton link={props.link} />
    </div>
  );
}

function tabRoute(tab: "agents" | "skills") {
  return tab === "skills" ? MARKETPLACE_SKILLS_ROUTE : MARKETPLACE_ROUTE;
}

/** Marketplace › Agents or Skills › the listing's category, each a link, in place of a single back link. */
function Breadcrumbs(props: { tab: "agents" | "skills"; category: SkillCategory | undefined }) {
  const { t } = useText();
  const route = () => tabRoute(props.tab);
  const tabLabel = () => (props.tab === "skills" ? t("marketplace.tab.skills") : t("marketplace.tab.agents"));
  return (
    <nav class="marketplace-site-crumbs" aria-label={t("sitePage.marketplace.breadcrumb")}>
      <ol>
        <li>
          <Link to={MARKETPLACE_ROUTE} class="marketplace-site-crumb">
            {t("marketplace.title")}
          </Link>
        </li>
        <li>
          <Link to={route()} class="marketplace-site-crumb">
            {tabLabel()}
          </Link>
        </li>
        <Show when={props.category}>
          {(category) => (
            <li>
              <Link to={route()} search={{ category: category() }} class="marketplace-site-crumb">
                {t(CATEGORY_LABELS[category()])}
              </Link>
            </li>
          )}
        </Show>
      </ol>
    </nav>
  );
}

/**
 * The frame of an agent or a skill page. The header is the plugin page's hero row: the mark, the
 * name, the byline and who checked it on the left, Add on the right of the same line, then the
 * description. Under a rule, the rows and the information side by side. The children are the rows.
 */
function ListingLayout(props: {
  tab: "agents" | "skills";
  link: MarketplaceListingLink;
  category: SkillCategory | undefined;
  name: string;
  verified: boolean;
  byline: string;
  description: string;
  trust: Trust;
  trustText: string;
  mark: () => JSX.Element;
  facts: readonly Fact[];
  children?: JSX.Element;
}) {
  // Reported as its tab: analytics names no listing, as it names no plugin.
  onSettled(() => landingAnalytics.start(document, window.location.hostname, tabRoute(props.tab)));
  return (
    <article class="post-container">
      <header class="marketplace-site-detail-head">
        <Breadcrumbs tab={props.tab} category={props.category} />
        <div class="plugin-hero-row marketplace-site-detail-row">
          <div class="plugin-hero-heading">
            <span class="marketplace-site-detail-mark">{props.mark()}</span>
            <div class="plugin-hero-text">
              <h1 class="plugin-intro-title marketplace-site-detail-title">
                <span class="marketplace-site-name">
                  {props.name}
                  <VerifiedMark verified={props.verified} />
                </span>
              </h1>
              <p class="marketplace-site-detail-by">{props.byline}</p>
              <TrustLine trust={props.trust} text={props.trustText} />
            </div>
          </div>
          <ListingActions link={props.link} name={props.name} />
        </div>
        <p class="marketplace-site-detail-description">{props.description}</p>
      </header>
      <div class="marketplace-site-detail-body">
        <div class="marketplace-site-detail-main">{props.children}</div>
        <Information facts={props.facts} />
      </div>
    </article>
  );
}

function AgentListingContent(props: { listing: MarketplaceAgentListing }) {
  const text = useText();
  const { t } = text;
  const agent = () => props.listing.agent;
  const verified = () => agent().verified === true;
  const trust = (): Trust => {
    if (agent().pending === true) return "pending";
    return verified() ? "verified" : "reviewed";
  };
  const trustText = () =>
    trust() === "pending"
      ? t("sitePage.marketplace.trust.agentPending")
      : t("sitePage.marketplace.trust.agentReviewed");
  const byline = () =>
    [agent().title, t("sitePage.marketplace.by", { name: agent().creatorName })].filter(Boolean).join(" · ");
  const facts = () => listingFacts(text, agent(), trust());
  const listed = (skill: MarketplaceAgentSkill): MarketplaceSkillSummary | undefined =>
    props.listing.skills.find((entry) => entry.id === skill.skillId);
  // A skill that is not in the catalog has no page, so its row has no link.
  const skillLink = (skill: MarketplaceAgentSkill): MarketplaceListingLink | undefined => {
    const entry = listed(skill);
    return entry ? { kind: "skill", id: entry.slug } : undefined;
  };
  const skillLine = (skill: MarketplaceAgentSkill) =>
    listed(skill)?.description ?? t("sitePage.marketplace.skillVersion", { version: skill.version });
  const skillIcon = (skill: MarketplaceAgentSkill) => ({ iconUrl: listed(skill)?.iconUrl ?? null });
  const routineLine = (routine: MarketplaceRoutineView) =>
    [
      routineScheduleSummary(routine.schedule, false, text),
      ...(routine.active ? [] : [t("sitePage.marketplace.routineOff")]),
    ].join(" · ");
  const mark = () => <AgentMark agent={agent()} />;
  const link = (): MarketplaceListingLink => ({ kind: "agent", id: agent().id });

  return (
    <ListingLayout
      tab="agents"
      link={link()}
      category={agent().category}
      name={agent().name}
      verified={verified()}
      byline={byline()}
      description={agent().description}
      trust={trust()}
      trustText={trustText()}
      mark={mark}
      facts={facts()}
    >
      <Show when={agent().skills.length > 0}>
        <DetailGroup id="marketplace-skills-title" title={t("marketplace.agents.skills")}>
          <For each={agent().skills}>
            {(skill) => (
              <DetailRow
                link={skillLink(skill)}
                name={skill.name}
                verified={listed(skill)?.verified === true}
                line={skillLine(skill)}
              >
                <SkillIcon skill={skillIcon(skill)} />
              </DetailRow>
            )}
          </For>
        </DetailGroup>
      </Show>
      <Show when={agent().routines.length > 0}>
        <DetailGroup id="marketplace-routines-title" title={t("marketplace.agents.routines")}>
          <For each={agent().routines}>
            {(routine) => (
              <DetailRow name={routine.name} line={routineLine(routine)}>
                <span class="marketplace-site-routine-mark">
                  <LandingIcon name="clock" />
                </span>
              </DetailRow>
            )}
          </For>
        </DetailGroup>
      </Show>
    </ListingLayout>
  );
}

function SkillListingContent(props: { skill: MarketplaceSkillView }) {
  const text = useText();
  const { t } = text;
  const verified = () => props.skill.verified === true;
  const trust = (): Trust => (verified() ? "verified" : "reviewed");
  const facts = () => listingFacts(text, props.skill, trust());
  const mark = () => <SkillIcon skill={props.skill} />;
  const link = (): MarketplaceListingLink => ({ kind: "skill", id: props.skill.slug });
  return (
    <ListingLayout
      tab="skills"
      link={link()}
      category={props.skill.category}
      name={props.skill.name}
      verified={verified()}
      byline={t("sitePage.marketplace.by", { name: props.skill.creatorName })}
      description={props.skill.description}
      trust={trust()}
      trustText={t("sitePage.marketplace.trust.skillReviewed")}
      mark={mark}
      facts={facts()}
    />
  );
}

interface PageLanguage {
  lang: string;
  locale: TranslatedLocale;
}

/** `/marketplace/agents/<id>`: an approved agent, or one that waits for its first review. */
export function MarketplaceAgentPage(props: PageLanguage & { listing: MarketplaceAgentListing }) {
  return (
    <MarketplaceFrame lang={props.lang} locale={props.locale}>
      <AgentListingContent listing={props.listing} />
    </MarketplaceFrame>
  );
}

/** `/marketplace/skills/<slug>`: an approved skill. */
export function MarketplaceSkillPage(props: PageLanguage & { skill: MarketplaceSkillView }) {
  return (
    <MarketplaceFrame lang={props.lang} locale={props.locale}>
      <SkillListingContent skill={props.skill} />
    </MarketplaceFrame>
  );
}
