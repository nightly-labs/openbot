import { createSignal, onSettled } from "solid-js";
import { OPENBOT_LINKS } from "../../lib/landing-links";
import { SiteLogoLink } from "../brand/SiteLogoLink";
import { Button, ButtonLink } from "../ui/button";
import { SiteLanguageMenu } from "./SiteLanguageMenu";
import { SiteMobileMenu } from "./SiteMobileMenu";
import { SiteNavigationMenu } from "./SiteNavigationMenu";
import { useSiteChrome } from "./SiteText";

export interface SiteHeaderProps {
  page: "landing" | "content";
  downloadRef?: (element: HTMLElement) => void;
}

export function SiteHeader(props: SiteHeaderProps) {
  const chrome = useSiteChrome();
  const text = () => chrome().text;
  const actions = (downloadRef?: (element: HTMLElement) => void) => (
    <>
      {props.page === "landing" ? (
        <Button ref={downloadRef} href={OPENBOT_LINKS.download} variant="primary" size="sm" icon="download">
          {text().download}
        </Button>
      ) : (
        <ButtonLink to="/download" variant="primary" size="sm" icon="download">
          {text().download}
        </ButtonLink>
      )}
      <ButtonLink
        to="/app"
        reloadDocument
        variant="secondary"
        size="sm"
        icon="arrow-right"
        class="landing-button-glass site-header-secondary"
      >
        {text().app}
      </ButtonLink>
    </>
  );

  const [stuck, setStuck] = createSignal(false);
  const stuckAttribute = () => (stuck() ? "" : undefined);
  let pageTop: HTMLSpanElement | undefined;
  onSettled(() => {
    if (!pageTop) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setStuck(!entry.isIntersecting);
    });
    observer.observe(pageTop);
    return () => {
      observer.disconnect();
    };
  });

  return (
    <>
      <span ref={pageTop} class="site-header-page-top" aria-hidden="true" />
      <header class="landing-header" data-enter="header" data-stuck={stuckAttribute()} lang={chrome().lang}>
        <SiteLogoLink />
        <SiteNavigationMenu />
        <div class="site-header-actions">
          <SiteLanguageMenu />
          {actions(props.downloadRef)}
          <SiteMobileMenu actions={() => actions()} />
        </div>
      </header>
    </>
  );
}
