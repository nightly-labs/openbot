import type { JSX } from "@solidjs/web";
import { onSettled } from "solid-js";
import { type LandingScreenPath, landingAnalytics } from "../../lib/analytics";
import { formatArticleDate } from "../../lib/content-collection";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";

export interface LegalPageProps {
  route: LandingScreenPath;
  title: string;
  /** The "Last updated" date, as `YYYY-MM-DD`. */
  updatedAt: string;
  children: JSX.Element;
}

// The article layout without the artwork, reading progress and related links: a legal text is read, not browsed.
export function LegalPage(props: LegalPageProps) {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, props.route));

  return (
    <div class="landing-page post-article">
      <SiteHeader page="content" />

      <main class="post-main">
        <article class="post-container post-article-body">
          <header class="post-article-header" data-enter="post-copy">
            <h1 class="post-article-title">{props.title}</h1>
            <p class="post-meta post-article-byline">
              Last updated <time datetime={props.updatedAt}>{formatArticleDate(props.updatedAt)}</time>
            </p>
          </header>

          <div class="post-prose" data-enter="post-prose">
            {props.children}
          </div>
        </article>
      </main>

      <LandingFooter />
    </div>
  );
}
