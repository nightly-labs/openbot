import type { JSX } from "@solidjs/web";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";

export interface TransactionalPageProps {
  titleId: string;
  layout?: "message" | "form";
  class?: string;
  lang?: string;
  children: JSX.Element;
}

export function TransactionalPage(props: TransactionalPageProps) {
  return (
    <div class="landing-page transactional-page">
      <SiteHeader page="content" />
      <main class="transactional-main" lang={props.lang}>
        <section
          class={props.class ? `join-card transactional-card ${props.class}` : "join-card transactional-card"}
          data-layout={props.layout ?? "message"}
          aria-labelledby={props.titleId}
        >
          {props.children}
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
