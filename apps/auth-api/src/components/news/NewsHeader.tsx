import { AppLogo } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import { Button, ButtonLink } from "../ui/button";

// The same header as the landing page. The download button addresses the landing
// route and its fragment rather than a bare "#download": there is no download
// section on a news page for a fragment on its own to find.
export function NewsHeader() {
  return (
    <header class="landing-header" data-enter="header">
      <Link class="landing-brand" to="/" aria-label="OpenBot home">
        <AppLogo variant="production" class="landing-brand-logo" />
        <span>OpenBot</span>
      </Link>

      <nav class="landing-navigation" aria-label="Primary navigation">
        <Link class="landing-header-link" to="/news">
          News
        </Link>
        <Button
          href={OPENBOT_LINKS.contact}
          target="_blank"
          rel={EXTERNAL_LINK_REL}
          variant="secondary"
          size="sm"
          icon="contact"
          class="landing-header-contact"
        >
          Contact
        </Button>
        <ButtonLink to="/" hash="download" variant="primary" size="sm" icon="download">
          Download
        </ButtonLink>
      </nav>
    </header>
  );
}
