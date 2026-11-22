import {
  CREDIT_MEDIA_KINDS,
  CREDIT_MODEL_COSTS,
  CREDIT_MODEL_MAKERS,
  type CreditMediaKind,
  type CreditModelCost,
  type CreditModelMaker,
  creditModelCharge,
} from "@openbot/contracts/credits";
import { CreditIcon } from "@openbot/ui/features/credits/CreditIcon";
import { Search } from "@openbot/ui/icons";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { CREDITS_ROUTE } from "../../lib/credits-page";
import { matchesMarketplaceQuery } from "../../lib/marketplace-routes";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";
import { CREDITS_QUERY_SLOT, type CreditsPageText } from "./credits-page-text";
import alibabaLogo from "./logos/alibaba.svg";
import bflLogo from "./logos/bfl.svg";
import bytedanceLogo from "./logos/bytedance.svg";
import googleLogo from "./logos/google.svg";
import ideogramLogo from "./logos/ideogram.svg";
import klingLogo from "./logos/kling.svg";
import metaLogo from "./logos/meta.svg";
import minimaxLogo from "./logos/minimax.svg";
import openaiLogo from "./logos/openai.svg";
import pixverseLogo from "./logos/pixverse.svg";
import recraftLogo from "./logos/recraft.svg";
import syncLogo from "./logos/sync.svg";
import tencentLogo from "./logos/tencent.svg";
import viduLogo from "./logos/vidu.svg";
import xaiLogo from "./logos/xai.svg";
import "./CreditsPage.css";

type CreditsFilter = "all" | CreditMediaKind;

const COLOR_LOGOS: Partial<Record<CreditModelMaker, string>> = {
  alibaba: alibabaLogo,
  bytedance: bytedanceLogo,
  google: googleLogo,
  kling: klingLogo,
  meta: metaLogo,
  minimax: minimaxLogo,
  pixverse: pixverseLogo,
  tencent: tencentLogo,
  vidu: viduLogo,
};

const MONO_LOGOS: Partial<Record<CreditModelMaker, string>> = {
  bfl: bflLogo,
  ideogram: ideogramLogo,
  openai: openaiLogo,
  recraft: recraftLogo,
  sync: syncLogo,
  xai: xaiLogo,
};

function MakerLogo(props: { maker: CreditModelMaker }) {
  const name = () => CREDIT_MODEL_MAKERS[props.maker];
  return (
    <span class="credits-logo" aria-hidden="true">
      <Show
        when={COLOR_LOGOS[props.maker]}
        fallback={
          <Show
            when={MONO_LOGOS[props.maker]}
            fallback={<span class="credits-logo-monogram">{name().slice(0, 1)}</span>}
          >
            {(src) => <span class="credits-logo-mono" style={{ "--credits-logo": `url("${src()}")` }} />}
          </Show>
        }
      >
        {(src) => <img class="credits-logo-image" src={src()} alt="" />}
      </Show>
    </span>
  );
}

function CreditsModelRow(props: { model: CreditModelCost; text: CreditsPageText; format: (value: number) => string }) {
  const unit = () => (props.model.unit === "image" ? props.text.perImage : props.text.perClip);
  return (
    <li class="credits-row">
      <MakerLogo maker={props.model.maker} />
      <div class="credits-row-body">
        <span class="credits-row-name">{props.model.name}</span>
        <span class="credits-row-maker">
          {CREDIT_MODEL_MAKERS[props.model.maker]}
          <Show when={props.model.variant}>{(variant) => <span class="credits-row-variant">{variant()}</span>}</Show>
        </span>
      </div>
      <div class="credits-row-cost">
        <span class="credits-row-credits">
          <CreditIcon />
          {props.format(creditModelCharge(props.model))}
          <span class="landing-visually-hidden">{props.text.credits}</span>
        </span>
        <span class="credits-row-unit">{unit()}</span>
      </div>
    </li>
  );
}

function CreditsSection(props: {
  kind: CreditMediaKind;
  models: readonly CreditModelCost[];
  text: CreditsPageText;
  format: (value: number) => string;
}) {
  const group = () => props.text[props.kind];
  const titleId = `credits-${props.kind}-title`;
  return (
    <section class="credits-section" aria-labelledby={titleId}>
      <header class="credits-section-header">
        <div class="credits-section-title">
          <h2 id={titleId}>{group().title}</h2>
          <span class="credits-section-count">{props.models.length}</span>
        </div>
        <p class="credits-section-unit">{group().unit}</p>
      </header>
      <ul class="credits-list">
        <For each={props.models}>
          {(model) => <CreditsModelRow model={model} text={props.text} format={props.format} />}
        </For>
      </ul>
    </section>
  );
}

function modelMatches(model: CreditModelCost, query: string, text: CreditsPageText): boolean {
  return matchesMarketplaceQuery(
    query,
    model.name,
    CREDIT_MODEL_MAKERS[model.maker],
    text[model.kind].title,
    model.variant ?? "",
  );
}

export function CreditsPage(props: { text: CreditsPageText; lang: string }) {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, CREDITS_ROUTE));
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<CreditsFilter>("all");
  const numberFormat = createMemo(() => new Intl.NumberFormat(props.lang));
  const format = (value: number) => numberFormat().format(value);
  const matches = createMemo(() => CREDIT_MODEL_COSTS.filter((model) => modelMatches(model, query(), props.text)));
  const countFor = (kind: CreditsFilter) =>
    kind === "all" ? matches().length : matches().filter((model) => model.kind === kind).length;
  const sections = createMemo(() =>
    CREDIT_MEDIA_KINDS.filter((kind) => filter() === "all" || filter() === kind)
      .map((kind) => ({ kind, models: matches().filter((model) => model.kind === kind) }))
      .filter((section) => section.models.length > 0),
  );
  const filters = (): readonly { value: CreditsFilter; label: string }[] => [
    { value: "all", label: props.text.all },
    ...CREDIT_MEDIA_KINDS.map((kind) => ({ value: kind, label: props.text[kind].title })),
  ];
  return (
    <div class="landing-page credits-page" lang={props.lang}>
      <SiteHeader page="content" />
      <main class="credits-main">
        <header class="compare-index-hero">
          <div class="landing-hero-grid" aria-hidden="true" />
          <h1 class="compare-index-title">{props.text.heading}</h1>
          <p class="compare-index-description">{props.text.intro}</p>
        </header>
        <div class="credits-toolbar">
          <div class="marketplace-site-search credits-search">
            <Search class="marketplace-site-search-icon" aria-hidden="true" />
            <input
              class="marketplace-site-search-input"
              type="search"
              value={query()}
              placeholder={props.text.search}
              aria-label={props.text.search}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          <fieldset class="plugin-filters credits-filters">
            <legend class="landing-visually-hidden">{props.text.categories}</legend>
            <For each={filters()}>
              {(option) => (
                <button
                  type="button"
                  class="plugin-tag-button credits-filter"
                  aria-pressed={`${filter() === option.value}`}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                  <span class="credits-filter-count">{countFor(option.value)}</span>
                </button>
              )}
            </For>
          </fieldset>
        </div>
        <Show
          when={sections().length > 0}
          fallback={<p class="credits-empty">{props.text.empty.replace(CREDITS_QUERY_SLOT, query().trim())}</p>}
        >
          <div class="credits-sections">
            <For each={sections()}>
              {(section) => (
                <CreditsSection kind={section.kind} models={section.models} text={props.text} format={format} />
              )}
            </For>
          </div>
        </Show>
      </main>
      <LandingFooter />
    </div>
  );
}
