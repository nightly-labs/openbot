import { AppLogo } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
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
}

// The one header of the public site. It keeps the `landing-header` class because
// analytics reads it to report a click as coming from the header.
export function SiteHeader(props: SiteHeaderProps) {
  const actions = () => (
    <>
      <Button
        href={OPENBOT_LINKS.contact}
        target="_blank"
        rel={EXTERNAL_LINK_REL}
        variant="secondary"
        size="sm"
        icon="contact"
        class="site-header-secondary site-header-contact"
      >
        Contact
      </Button>
      {/* A full page load: the /app route brings the desktop document styles, which stop the site page from
          scrolling. A preload on hover or a client-side visit would add them to this page. */}
      <ButtonLink
        to="/app"
        reloadDocument
        variant="secondary"
        size="sm"
        icon="arrow-right"
        class="site-header-secondary"
      >
        App
      </ButtonLink>
      {props.page === "landing" ? (
        <Button href={OPENBOT_LINKS.download} variant="primary" size="sm" icon="download">
          Download
        </Button>
      ) : (
        <ButtonLink to="/download" variant="primary" size="sm" icon="download">
          Download
        </ButtonLink>
      )}
    </>
  );

  return (
    <header class="landing-header" data-enter="header">
      <Link class="landing-brand" to="/" aria-label="OpenBot home">
        <AppLogo variant="production" class="landing-brand-logo" />
        <span>OpenBot</span>
      </Link>
      <SiteNavigationMenu />
      <div class="site-header-actions">
        {actions()}
        <SiteMobileMenu actions={actions} />
      </div>
    </header>
  );
}
