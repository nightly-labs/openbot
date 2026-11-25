import { type CreditMediaModel, creditMediaCost } from "@openbot/contracts/credit-media";
import {
  CREDIT_CLIP_SECONDS,
  CREDIT_MEDIA_KINDS,
  CREDIT_MODEL_COSTS,
  CREDIT_MODEL_MAKERS,
  type CreditMediaKind,
  type CreditModelCost,
} from "@openbot/contracts/credits";
import { CreditIcon } from "@openbot/ui/features/credits/CreditIcon";
import { MakerLogo } from "@openbot/ui/features/credits/MakerLogo";
import { Search } from "@openbot/ui/icons";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { CREDITS_ROUTE } from "../../lib/credits-page";
import { matchesMarketplaceQuery } from "../../lib/marketplace-routes";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";
import { CREDITS_QUERY_SLOT, CREDITS_SECONDS_SLOT, type CreditsPageText } from "./credits-page-text";
import "./CreditsPage.css";

type CreditsFilter = "all" | CreditMediaKind;

const VIDEO_LENGTHS: readonly number[] = [CREDIT_CLIP_SECONDS, CREDIT_CLIP_SECONDS * 2];

interface CreditsEntry {
  model: CreditModelCost;
  live: CreditMediaModel | undefined;
}

interface CreditsVideoSpec {
  seconds: number;
  sound: boolean;
}

interface CreditsPrice {
  resolution: string | null;
  charge: number;
}

interface CreditsChoice<T> {
  value: T;
  label: string;
}

function livePrices(model: CreditMediaModel, spec: CreditsVideoSpec): CreditsPrice[] {
  const resolutions: readonly (string | null)[] = model.resolutions.length > 0 ? model.resolutions : [null];
  return resolutions.flatMap((resolution) => {
    const charge = creditMediaCost(model, { resolution, duration: spec.seconds, count: 1, audio: spec.sound });
    return charge === null ? [] : [{ resolution, charge }];
  });
}

function hasSilentPrice(model: CreditMediaModel): boolean {
  return model.audio && model.prices.some((price) => price.silentCredits !== null);
}

function CreditsPrices(props: {
  live: CreditMediaModel;
  spec: CreditsVideoSpec;
  text: CreditsPageText;
  format: (value: number) => string;
}) {
  return (
    <ul class="credits-prices">
      <For each={livePrices(props.live, props.spec)}>
        {(price) => (
          <li class="credits-price">
            <Show when={price.resolution}>
              {(resolution) => <span class="credits-price-resolution">{resolution()}</span>}
            </Show>
            <span class="credits-price-credits">
              <CreditIcon />
              {props.format(price.charge)}
              <span class="landing-visually-hidden">{props.text.credits}</span>
            </span>
          </li>
        )}
      </For>
    </ul>
  );
}

function CreditsModelRow(props: {
  entry: CreditsEntry;
  spec: CreditsVideoSpec;
  text: CreditsPageText;
  format: (value: number) => string;
}) {
  const unit = (live: CreditMediaModel) =>
    live.kind === "image"
      ? props.text.perImage
      : props.text.perSeconds.replace(CREDITS_SECONDS_SLOT, props.format(props.spec.seconds));
  return (
    <li class="credits-row">
      <div class="credits-row-head">
        <span class="credits-logo" aria-hidden="true">
          <MakerLogo maker={props.entry.model.maker} />
        </span>
        <div class="credits-row-body">
          <span class="credits-row-name">{props.entry.model.name}</span>
          <span class="credits-row-maker">
            {CREDIT_MODEL_MAKERS[props.entry.model.maker]}
            <Show when={props.entry.model.variant}>
              {(variant) => <span class="credits-row-variant">{variant()}</span>}
            </Show>
          </span>
        </div>
        <Show when={props.entry.live} fallback={<span class="credits-row-soon">{props.text.soon}</span>}>
          {(live) => <span class="credits-row-unit">{unit(live())}</span>}
        </Show>
      </div>
      <Show when={props.entry.live}>
        {(live) => <CreditsPrices live={live()} spec={props.spec} text={props.text} format={props.format} />}
      </Show>
    </li>
  );
}

function CreditsSection(props: {
  kind: CreditMediaKind;
  entries: readonly CreditsEntry[];
  spec: CreditsVideoSpec;
  text: CreditsPageText;
  format: (value: number) => string;
}) {
  const titleId = `credits-${props.kind}-title`;
  return (
    <section class="credits-section" aria-labelledby={titleId}>
      <header class="credits-section-header">
        <div class="credits-section-title">
          <h2 id={titleId}>{props.text[props.kind]}</h2>
          <span class="credits-section-count">{props.entries.length}</span>
        </div>
      </header>
      <ul class="credits-list">
        <For each={props.entries}>
          {(entry) => <CreditsModelRow entry={entry} spec={props.spec} text={props.text} format={props.format} />}
        </For>
      </ul>
    </section>
  );
}

function CreditsOption<T>(props: {
  label: string;
  choices: readonly CreditsChoice<T>[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <fieldset class="credits-option">
      <legend class="landing-visually-hidden">{props.label}</legend>
      <span class="credits-option-label" aria-hidden="true">
        {props.label}
      </span>
      <For each={props.choices}>
        {(choice) => (
          <button
            type="button"
            class="plugin-tag-button credits-filter"
            aria-pressed={`${props.selected === choice.value}`}
            onClick={() => props.onSelect(choice.value)}
          >
            {choice.label}
          </button>
        )}
      </For>
    </fieldset>
  );
}

function modelMatches(model: CreditModelCost, query: string, text: CreditsPageText): boolean {
  return matchesMarketplaceQuery(
    query,
    model.name,
    CREDIT_MODEL_MAKERS[model.maker],
    text[model.kind],
    model.variant ?? "",
  );
}

export function CreditsPage(props: { text: CreditsPageText; lang: string; catalog: readonly CreditMediaModel[] }) {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, CREDITS_ROUTE));
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<CreditsFilter>("all");
  const [seconds, setSeconds] = createSignal(CREDIT_CLIP_SECONDS);
  const [sound, setSound] = createSignal(true);
  const spec = (): CreditsVideoSpec => ({ seconds: seconds(), sound: sound() });
  const numberFormat = createMemo(() => new Intl.NumberFormat(props.lang));
  const format = (value: number) => numberFormat().format(value);
  const entries = createMemo(() => {
    const live = new Map(props.catalog.map((model) => [model.id, model]));
    const all = CREDIT_MODEL_COSTS.map((model) => ({ model, live: live.get(model.modelId) }));
    return [...all.filter((entry) => entry.live), ...all.filter((entry) => !entry.live)];
  });
  const matches = createMemo(() => entries().filter((entry) => modelMatches(entry.model, query(), props.text)));
  const countFor = (kind: CreditsFilter) =>
    kind === "all" ? matches().length : matches().filter((entry) => entry.model.kind === kind).length;
  const sections = createMemo(() =>
    CREDIT_MEDIA_KINDS.filter((kind) => filter() === "all" || filter() === kind)
      .map((kind) => ({ kind, entries: matches().filter((entry) => entry.model.kind === kind) }))
      .filter((section) => section.entries.length > 0),
  );
  const liveVideo = () =>
    sections()
      .filter((section) => section.kind === "video")
      .flatMap((section) => section.entries.flatMap((entry) => (entry.live ? [entry.live] : [])));
  const filters = (): readonly CreditsChoice<CreditsFilter>[] => [
    { value: "all", label: props.text.all },
    ...CREDIT_MEDIA_KINDS.map((kind) => ({ value: kind, label: props.text[kind] })),
  ];
  const lengths = (): readonly CreditsChoice<number>[] =>
    VIDEO_LENGTHS.map((value) => ({ value, label: props.text.seconds.replace(CREDITS_SECONDS_SLOT, format(value)) }));
  const sounds = (): readonly CreditsChoice<boolean>[] => [
    { value: true, label: props.text.soundOn },
    { value: false, label: props.text.soundOff },
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
          <Show when={liveVideo().length > 0}>
            <div class="credits-options">
              <CreditsOption label={props.text.length} choices={lengths()} selected={seconds()} onSelect={setSeconds} />
              <Show when={liveVideo().some(hasSilentPrice)}>
                <CreditsOption label={props.text.sound} choices={sounds()} selected={sound()} onSelect={setSound} />
              </Show>
            </div>
          </Show>
        </div>
        <Show
          when={sections().length > 0}
          fallback={<p class="credits-empty">{props.text.empty.replace(CREDITS_QUERY_SLOT, query().trim())}</p>}
        >
          <div class="credits-sections">
            <For each={sections()}>
              {(section) => (
                <CreditsSection
                  kind={section.kind}
                  entries={section.entries}
                  spec={spec()}
                  text={props.text}
                  format={format}
                />
              )}
            </For>
          </div>
        </Show>
      </main>
      <LandingFooter />
    </div>
  );
}
