import { OPENBOT_LINKS } from "../../lib/landing-links";
import { SiteLogoLink } from "../brand/SiteLogoLink";
import { Button, ButtonLink } from "../ui/button";
import { SiteMobileMenu } from "./SiteMobileMenu";
import { SiteNavigationMenu } from "./SiteNavigationMenu";

export interface SiteHeaderProps {
  /**
   * The landing page has its own download section, so its button scrolls to it.
   * Every other page opens /download: there is no download section there for a
   * bare "#download" to find.
   */
  page: "landing" | "content";
  /** Receives the header's download button. The landing hero beam comes out of it. */
  downloadRef?: (element: HTMLElement) => void;
}

// The one header of the public site. It keeps the `landing-header` class because
// analytics reads it to report a click as coming from the header.
export function SiteHeader(props: SiteHeaderProps) {
  // The mobile sheet repeats these actions. Only the header's own copy is the beam's source.
  const actions = (downloadRef?: (element: HTMLElement) => void) => (
    <>
      {props.page === "landing" ? (
        <Button ref={downloadRef} href={OPENBOT_LINKS.download} variant="primary" size="sm" icon="download">
          Download
        </Button>
      ) : (
        <ButtonLink to="/download" variant="primary" size="sm" icon="download">
          Download
        </ButtonLink>
      )}
      {/* A full page load: the /app route brings the desktop document styles, which stop the site page from
          scrolling. A preload on hover or a client-side visit would add them to this page. */}
      <ButtonLink
        to="/app"
        reloadDocument
        variant="secondary"
        size="sm"
        icon="arrow-right"
        class="landing-button-glass site-header-secondary"
      >
        App
      </ButtonLink>
    </>
  );

  return (
    <header class="landing-header" data-enter="header">
      <SiteLogoLink />
      <SiteNavigationMenu />
      <div class="site-header-actions">
        {actions(props.downloadRef)}
        <SiteMobileMenu actions={() => actions()} />
      </div>
    </header>
  );
}
