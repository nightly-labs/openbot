import { Show } from "solid-js";
import type { PageText } from "../../lib/page-text";
import { LandingFooter } from "../landing/LandingFooter";
import { NotFoundPage } from "../landing/NotFoundPage";
import { SiteHeader } from "../landing/SiteHeader";
import { ButtonLink } from "../ui/button";
import type { MarketplaceMissingText } from "./marketplace-page-text";

export type MarketplaceMissingData = Pick<PageText<MarketplaceMissingText>, "lang" | "text">;

export function isMarketplaceMissingData(value: unknown): value is MarketplaceMissingData {
  if (typeof value !== "object" || value === null || !("text" in value) || !("lang" in value)) return false;
  const text = value.text;
  return (
    typeof value.lang === "string" &&
    typeof text === "object" &&
    text !== null &&
    "title" in text &&
    "body" in text &&
    "open" in text &&
    typeof text.title === "string" &&
    typeof text.body === "string" &&
    typeof text.open === "string"
  );
}

export function MarketplaceMissingPage(props: { data?: unknown }) {
  const page = () => (isMarketplaceMissingData(props.data) ? props.data : undefined);
  const siteNotFound = () => <NotFoundPage />;
  return (
    <Show when={page()} fallback={siteNotFound()}>
      {(found) => (
        <div class="landing-page plugin-index marketplace-site" lang={found().lang}>
          <SiteHeader page="content" />
          <main class="post-main">
            <div class="post-container">
              <div class="plugin-intro">
                <h1 class="plugin-intro-title">{found().text.title}</h1>
              </div>
              <p class="post-article-standfirst marketplace-site-missing">{found().text.body}</p>
              <div class="marketplace-site-missing-actions">
                <ButtonLink to="/marketplace" variant="primary" size="lg" icon="arrow-right">
                  {found().text.open}
                </ButtonLink>
              </div>
            </div>
          </main>
          <LandingFooter />
        </div>
      )}
    </Show>
  );
}
