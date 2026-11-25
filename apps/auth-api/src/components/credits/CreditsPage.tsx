import { type CreditMediaModel, type CreditMediaPrice, creditMediaPrice } from "@openbot/contracts/credit-media";
import {
  CREDIT_MEDIA_KINDS,
  CREDIT_MODEL_COSTS,
  CREDIT_MODEL_MAKERS,
  type CreditMediaKind,
  type CreditModelMaker,
} from "@openbot/contracts/credits";
import { CreditIcon } from "@openbot/ui/features/credits/CreditIcon";
import { creditModelMakerNamed, MakerLogo } from "@openbot/ui/features/credits/MakerLogo";
import { Search } from "@openbot/ui/icons";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { CREDITS_ROUTE } from "../../lib/credits-page";
import { matchesMarketplaceQuery } from "../../lib/marketplace-routes";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";
import { CREDITS_AMOUNT_SLOT, CREDITS_QUERY_SLOT, type CreditsPageText } from "./credits-page-text";
import "./CreditsPage.css";

type CreditsFilter = "all" | CreditMediaKind;

interface CreditsModel {
  id: string;
  kind: CreditMediaKind;
  name: string;
  maker: CreditModelMaker | undefined;
  makerName: string;
  variant: string | undefined;
}

interface CreditsEntry {
  model: CreditsModel;
  live: CreditMediaModel | undefined;
}

interface CreditsLiveEntry {
  model: CreditsModel;
  live: CreditMediaModel;
}

interface CreditsPriceProps {
  text: CreditsPageText;
  format: (value: number) => string;
}

function resolutionRank(resolution: string): number {
  const value = Number.parseFloat(resolution);
  if (!Number.isFinite(value)) return Number.MAX_SAFE_INTEGER;
  return resolution.endsWith("K") ? value * 1000 : value;
}

function priceColumns(entries: readonly CreditsLiveEntry[]): (string | null)[] {
  const resolutions = [...new Set(entries.flatMap((entry) => entry.live.resolutions))].sort(
    (left, right) => resolutionRank(left) - resolutionRank(right),
  );
  return entries.some((entry) => entry.live.resolutions.length === 0) ? [null, ...resolutions] : resolutions;
}

function cellPrice(model: CreditMediaModel, column: string | null): CreditMediaPrice | null {
  if (column === null) return model.resolutions.length === 0 ? creditMediaPrice(model, null) : null;
  return model.resolutions.includes(column) ? creditMediaPrice(model, column) : null;
}

function silentCredits(model: CreditMediaModel, price: CreditMediaPrice): number | null {
  return model.audio ? price.silentCredits : null;
}

function sectionUnit(kind: CreditMediaKind, entries: readonly CreditsLiveEntry[], text: CreditsPageText): string {
  if (entries.some((entry) => entry.live.prices.some((price) => price.unit === "second"))) return text.perSecond;
  return kind === "image" ? text.perImage : text.perGeneration;
}

function staticModels(): CreditsModel[] {
  return CREDIT_MODEL_COSTS.map((model) => ({
    id: model.modelId,
    kind: model.kind,
    name: model.name,
    maker: model.maker,
    makerName: CREDIT_MODEL_MAKERS[model.maker],
    variant: model.variant,
  }));
}

function catalogModel(model: CreditMediaModel): CreditsModel {
  return {
    id: model.id,
    kind: model.kind,
    name: model.name,
    maker: creditModelMakerNamed(model.maker),
    makerName: model.maker,
    variant: model.variant ?? undefined,
  };
}

function creditsEntries(catalog: readonly CreditMediaModel[]): CreditsEntry[] {
  const live = new Map(catalog.map((model) => [model.id, model]));
  const known = staticModels();
  const knownIds = new Set(known.map((model) => model.id));
  return [
    ...known.map((model) => ({ model, live: live.get(model.id) })),
    ...catalog.filter((model) => !knownIds.has(model.id)).map((model) => ({ model: catalogModel(model), live: model })),
  ];
}

function CreditsMakerLogo(props: { maker: CreditModelMaker | undefined }) {
  return <Show when={props.maker}>{(maker) => <MakerLogo maker={maker()} />}</Show>;
}

function CreditsModelIdentity(props: { model: CreditsModel }) {
  return (
    <div class="credits-model">
      <span class="credits-logo" aria-hidden="true">
        <CreditsMakerLogo maker={props.model.maker} />
      </span>
      <div class="credits-model-body">
        <span class="credits-model-name">{props.model.name}</span>
        <span class="credits-model-maker">
          {props.model.makerName}
          <Show when={props.model.variant}>{(variant) => <span class="credits-model-variant">{variant()}</span>}</Show>
        </span>
      </div>
    </div>
  );
}

function CreditsPriceCell(props: CreditsPriceProps & { model: CreditMediaModel; column: string | null }) {
  const price = () => cellPrice(props.model, props.column);
  return (
    <td class="credits-cell">
      <Show
        when={price()}
        fallback={
          <>
            <span class="credits-cell-none" aria-hidden="true">
              –
            </span>
            <span class="landing-visually-hidden">{props.text.notAvailable}</span>
          </>
        }
      >
        {(available) => (
          <>
            <span class="credits-cell-amount">
              <CreditIcon />
              {props.format(available().credits)}
              <span class="landing-visually-hidden">{props.text.credits}</span>
            </span>
            <Show when={silentCredits(props.model, available())}>
              {(silent) => (
                <span class="credits-cell-silent">
                  {props.text.withoutSound.replace(CREDITS_AMOUNT_SLOT, props.format(silent()))}
                </span>
              )}
            </Show>
          </>
        )}
      </Show>
    </td>
  );
}

function CreditsTable(props: CreditsPriceProps & { titleId: string; entries: readonly CreditsLiveEntry[] }) {
  const columns = () => priceColumns(props.entries);
  return (
    <div class="credits-table-scroll">
      <table class="credits-table" aria-labelledby={props.titleId}>
        <thead>
          <tr>
            <th scope="col" class="credits-table-model">
              {props.text.model}
            </th>
            <For each={columns()}>{(column) => <th scope="col">{column ?? props.text.oneSize}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={props.entries}>
            {(entry) => (
              <tr>
                <th scope="row" class="credits-table-model">
                  <CreditsModelIdentity model={entry.model} />
                </th>
                <For each={columns()}>
                  {(column) => (
                    <CreditsPriceCell model={entry.live} column={column} text={props.text} format={props.format} />
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function CreditsSoon(props: { models: readonly CreditsModel[]; text: CreditsPageText }) {
  return (
    <div class="credits-soon">
      <span class="credits-soon-label">{props.text.soon}</span>
      <ul class="credits-soon-list">
        <For each={props.models}>
          {(model) => (
            <li class="credits-soon-model">
              <span class="credits-soon-logo" aria-hidden="true">
                <CreditsMakerLogo maker={model.maker} />
              </span>
              {model.name}
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

function liveEntries(entries: readonly CreditsEntry[]): CreditsLiveEntry[] {
  return entries.flatMap((entry) => (entry.live ? [{ model: entry.model, live: entry.live }] : []));
}

function CreditsSection(props: CreditsPriceProps & { kind: CreditMediaKind; entries: readonly CreditsEntry[] }) {
  const titleId = `credits-${props.kind}-title`;
  const live = () => liveEntries(props.entries);
  const soon = () => props.entries.filter((entry) => !entry.live).map((entry) => entry.model);
  return (
    <section class="credits-section" aria-labelledby={titleId}>
      <header class="credits-section-header">
        <div class="credits-section-title">
          <h2 id={titleId}>{props.text[props.kind]}</h2>
          <span class="credits-section-count">{props.entries.length}</span>
        </div>
        <Show when={live().length > 0}>
          <span class="credits-section-unit">{sectionUnit(props.kind, live(), props.text)}</span>
        </Show>
      </header>
      <Show when={live().length > 0}>
        <CreditsTable titleId={titleId} entries={live()} text={props.text} format={props.format} />
      </Show>
      <Show when={soon().length > 0}>
        <CreditsSoon models={soon()} text={props.text} />
      </Show>
    </section>
  );
}

function modelMatches(model: CreditsModel, query: string, text: CreditsPageText): boolean {
  return matchesMarketplaceQuery(query, model.name, model.makerName, text[model.kind], model.variant ?? "");
}

export function CreditsPage(props: { text: CreditsPageText; lang: string; catalog: readonly CreditMediaModel[] }) {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, CREDITS_ROUTE));
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<CreditsFilter>("all");
  const numberFormat = createMemo(() => new Intl.NumberFormat(props.lang));
  const format = (value: number) => numberFormat().format(value);
  const entries = createMemo(() => creditsEntries(props.catalog));
  const matches = createMemo(() => entries().filter((entry) => modelMatches(entry.model, query(), props.text)));
  const countFor = (kind: CreditsFilter) =>
    kind === "all" ? matches().length : matches().filter((entry) => entry.model.kind === kind).length;
  const sections = createMemo(() =>
    CREDIT_MEDIA_KINDS.filter((kind) => filter() === "all" || filter() === kind)
      .map((kind) => ({ kind, entries: matches().filter((entry) => entry.model.kind === kind) }))
      .filter((section) => section.entries.length > 0),
  );
  const filters = (): readonly { value: CreditsFilter; label: string }[] => [
    { value: "all", label: props.text.all },
    ...CREDIT_MEDIA_KINDS.map((kind) => ({ value: kind, label: props.text[kind] })),
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
                <CreditsSection kind={section.kind} entries={section.entries} text={props.text} format={format} />
              )}
            </For>
          </div>
        </Show>
      </main>
      <LandingFooter />
    </div>
  );
}
