import { AppLogo } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { EXTERNAL_LINK_REL, FOOTER_COLUMNS, type FooterLink, OPENBOT_LINKS } from "../../lib/landing-links";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";

const FOOTER_DESCRIPTION =
  "Persistent AI teammates on your own computer. Run Codex, Claude, Gemini, Grok, Muse Code, Pi or your own model with the plans you already pay for.";

const SOCIALS = [
  {
    label: "GitHub",
    href: OPENBOT_LINKS.repository,
    path: "M12 .7C5.7.7.8 5.6.8 11.9c0 5 3.2 9.3 7.6 10.8.6.1.8-.3.8-.6v-2.2c-3.1.7-3.8-1.3-3.8-1.3-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.5-.3-5.1-1.2-5.1-5.6 0-1.2.4-2.2 1.2-3-.1-.3-.5-1.5.1-3 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C17.7 6 18.8 6.3 18.8 6.3c.6 1.5.2 2.7.1 3 .8.8 1.2 1.8 1.2 3 0 4.4-2.6 5.3-5.1 5.6.4.4.8 1.1.8 2.1v3.2c0 .3.2.7.8.6a11.2 11.2 0 0 0 7.6-10.8C23.2 5.6 18.3.7 12 .7Z",
  },
  {
    label: "X",
    href: OPENBOT_LINKS.x,
    path: "M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.5L4.7 21H1.5l7.5-8.5L1.1 3h6.5l4.5 6 5.4-6Zm-1.1 16h1.8L7.6 4.9H5.7L16.4 19Z",
  },
  {
    label: "Discord",
    href: OPENBOT_LINKS.discord,
    path: "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z",
  },
] as const;

export function LandingFooter() {
  let footerRef: HTMLElement | undefined;
  const currentYear = new Date().getFullYear();
  const revealed = createLandingReveal(() => footerRef);

  const revealState = () => (revealed() ? "true" : "false");

  return (
    <footer ref={footerRef} class="landing-footer" data-slot="landing-footer">
      <div class="landing-footer-inner">
        <div class="landing-footer-grid">
          <div class="landing-footer-brand" data-revealed={revealState()}>
            <Link class="landing-footer-lockup" to="/" aria-label="OpenBot home">
              <AppLogo variant="production" class="landing-footer-logo" />
              <span>OpenBot</span>
            </Link>

            <p class="landing-footer-description">{FOOTER_DESCRIPTION}</p>

            <Link class="landing-footer-cta" to="/download">
              <span>Download OpenBot</span>
              <LandingIcon name="download" />
            </Link>

            <div class="landing-footer-socials">
              <For each={SOCIALS}>
                {(social) => (
                  <a
                    class="landing-footer-social"
                    href={social.href}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    aria-label={social.label}
                  >
                    <span class="landing-visually-hidden">{social.label}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={social.path} />
                    </svg>
                  </a>
                )}
              </For>
            </div>
          </div>

          <nav class="landing-footer-columns" aria-label="Footer navigation" data-revealed={revealState()}>
            <For each={FOOTER_COLUMNS}>
              {(column) => (
                <div class="landing-footer-column">
                  <h2>{column.title}</h2>
                  <ul>
                    <For each={column.links}>
                      {(link) => (
                        <li>
                          <FooterNavLink link={link} />
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              )}
            </For>
          </nav>
        </div>

        <div class="landing-footer-bottom" data-revealed={revealState()}>
          <p>&copy; {currentYear} Synthetify Labs, All rights reserved.</p>
          <div class="landing-footer-meta">
            <Link to="/download">
              <span class="landing-footer-availability" aria-hidden="true" />
              Available for macOS, Windows, Linux, iOS and Android
            </Link>
            <p class="landing-footer-made">
              Made with
              <LandingIcon name="heart" label="love" />
              in Poland
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

// An entry that points inside the site is a route, and goes through the router so
// the page is not fetched and parsed again. An external one stays a plain anchor.
function FooterNavLink(props: { link: FooterLink }) {
  const external = () => (props.link.external ? props.link : undefined);
  const page = () => (props.link.external || "slug" in props.link ? undefined : props.link);
  const article = () => (!props.link.external && "slug" in props.link ? props.link : undefined);

  return (
    <>
      <Show when={external()}>
        {(link) => (
          <a href={link().href} target="_blank" rel={EXTERNAL_LINK_REL}>
            {link().label}
          </a>
        )}
      </Show>
      <Show when={page()}>
        {(link) => (
          <Show when={link().hash} fallback={<Link to={link().to}>{link().label}</Link>}>
            {(hash) => (
              <Link to={link().to} hash={hash()}>
                {link().label}
              </Link>
            )}
          </Show>
        )}
      </Show>
      <Show when={article()}>
        {(link) => (
          <Link to={link().to} params={{ slug: link().slug }}>
            {link().label}
          </Link>
        )}
      </Show>
    </>
  );
}
