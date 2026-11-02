import { AppLogo } from "@openbot/brand";
import type { JSX } from "@solidjs/web";
import { createSignal, For, onSettled } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import {
  BRAND_ICONS,
  BRAND_LOCKUPS,
  BRAND_SQUARES,
  type BrandAsset,
  type BrandSpace,
  brandAssetPath,
} from "../../lib/brand-assets";
import { BRAND_ROUTE } from "../../lib/brand-page";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";
import { copyBrandSvg, saveBrandPng, saveBrandZip } from "./brand-files";

/** How long "Copied" stays on a copy button. */
const COPIED_MS = 1600;

// The /brand page: the mark on a lilac panel, then every logo file in three groups. Each logo is an
// <img> of its served SVG file, so a right-click opens the browser's own image menu.
export function BrandPage() {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, BRAND_ROUTE));

  return (
    <div class="landing-page brand-page">
      <SiteHeader page="content" />
      <main class="download-main brand-main">
        <header class="brand-hero" data-enter="post-copy">
          <BrandStage />
          <div class="brand-hero-row">
            <div class="brand-hero-text">
              <h1 class="post-article-title brand-hero-title">Brand</h1>
              <p class="post-article-standfirst brand-hero-intro">
                The OpenBot logo in each shape and color. Right-click a logo to save or copy it.
              </p>
            </div>
            <DownloadAllButton />
          </div>
        </header>
        <BrandAssetGroups />
      </main>
      <LandingFooter />
    </div>
  );
}

/**
 * The face of the mark on a lilac panel. The eyes follow the pointer anywhere on the panel, a click
 * on it winks, and five fast clicks make the whole panel flash the brand colors.
 */
function BrandStage() {
  const [panel, setPanel] = createSignal<HTMLDivElement>();
  return (
    <div ref={setPanel} class="brand-stage">
      <AppLogo variant="production" animation="blink" interactive pointerArea={panel()} class="brand-stage-logo" />
    </div>
  );
}

function DownloadAllButton() {
  const [busy, setBusy] = createSignal(false);
  const download = async () => {
    setBusy(true);
    try {
      await saveBrandZip();
    } catch {
      // The browser could not draw a file. Nothing is saved, and the button can try again.
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      class="landing-button landing-button-primary landing-button-md"
      data-icon="download"
      disabled={busy()}
      onClick={() => void download()}
    >
      {busy() ? "Preparing files…" : "Download all"}
    </button>
  );
}

function BrandAssetGroups() {
  const [space, setSpace] = createSignal<BrandSpace>("tight");
  return (
    <div class="brand-groups">
      <BrandAssetGroup title="App icon" assets={BRAND_ICONS} />
      <BrandAssetGroup title="Square icon" assets={BRAND_SQUARES} />
      <BrandAssetGroup title="Logo with name" assets={BRAND_LOCKUPS[space()]} wide>
        <fieldset class="plugin-filters brand-space-toggle">
          <legend class="landing-visually-hidden">Clear space</legend>
          <button
            type="button"
            class="plugin-tag-button"
            aria-pressed={space() === "tight" ? "true" : "false"}
            onClick={() => setSpace("tight")}
          >
            No clear space
          </button>
          <button
            type="button"
            class="plugin-tag-button"
            aria-pressed={space() === "safe" ? "true" : "false"}
            onClick={() => setSpace("safe")}
          >
            Clear space
          </button>
        </fieldset>
      </BrandAssetGroup>
    </div>
  );
}

function BrandAssetGroup(props: {
  title: string;
  assets: readonly BrandAsset[];
  wide?: boolean;
  children?: JSX.Element;
}) {
  return (
    <section class="brand-group">
      <div class="brand-group-head">
        <h2 class="brand-group-title">{props.title}</h2>
        {props.children}
      </div>
      <ul class="brand-cards" data-wide={props.wide ? "true" : undefined}>
        <For each={props.assets}>{(asset) => <BrandAssetCard asset={asset} />}</For>
      </ul>
    </section>
  );
}

function BrandAssetCard(props: { asset: BrandAsset }) {
  return (
    <li class="brand-card">
      <div class="brand-card-art" data-surface={props.asset.surface}>
        <img
          class="brand-card-image"
          src={brandAssetPath(props.asset)}
          alt={`OpenBot ${props.asset.label}`}
          width={props.asset.width}
          height={props.asset.height}
        />
      </div>
      <div class="brand-card-body">
        <h3 class="brand-card-name">{props.asset.label}</h3>
        <div class="brand-card-actions">
          <a
            class="landing-button landing-button-secondary landing-button-sm"
            data-icon="download"
            href={brandAssetPath(props.asset)}
            download={`${props.asset.file}.svg`}
          >
            SVG
          </a>
          <button
            type="button"
            class="landing-button landing-button-secondary landing-button-sm"
            data-icon="download"
            onClick={() => void saveBrandPng(props.asset).catch(() => undefined)}
          >
            PNG
          </button>
          <CopySvgButton asset={props.asset} />
        </div>
      </div>
    </li>
  );
}

function CopySvgButton(props: { asset: BrandAsset }) {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const copy = async () => {
    try {
      await copyBrandSvg(props.asset);
    } catch {
      // The clipboard is not allowed. The SVG button still saves the file.
      return;
    }
    setCopied(true);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), COPIED_MS);
  };
  onSettled(() => () => clearTimeout(timer));
  return (
    <button
      type="button"
      class="landing-button landing-button-secondary landing-button-sm"
      data-icon={copied() ? "check" : "copy"}
      onClick={() => void copy()}
    >
      {copied() ? "Copied" : "Copy SVG"}
    </button>
  );
}
