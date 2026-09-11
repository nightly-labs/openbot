import { AppLogo } from "@openbot/brand";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import { Button } from "../ui/button";

// The same header as the landing page, with one difference: the download button
// points at "/#download" instead of "#download". A bare fragment on /news only
// scrolls the current page, and there is no download section on it.
export function NewsHeader() {
  return (
    <header class="landing-header" data-enter="header">
      <a class="landing-brand" href="/" aria-label="OpenBot home">
        <AppLogo variant="production" class="landing-brand-logo" />
        <span>OpenBot</span>
      </a>

      <nav class="landing-navigation" aria-label="Primary navigation">
        <a class="landing-header-link" href={OPENBOT_LINKS.news}>
          News
        </a>
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
        <Button href={OPENBOT_LINKS.downloadFromOtherPage} variant="primary" size="sm" icon="download">
          Download
        </Button>
      </nav>
    </header>
  );
}
