import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";
import { ButtonLink } from "../ui/button";

export function AgentTemplateNotSharedPage() {
  return (
    <div class="landing-page agent-share-page">
      <SiteHeader page="content" />

      <main class="agent-share-main">
        <div class="landing-hero-grid" aria-hidden="true" />
        <section class="agent-share-card" aria-labelledby="agent-share-gone-title">
          <div class="agent-share-body">
            <h1 class="agent-share-name" id="agent-share-gone-title">
              This agent is no longer shared
            </h1>
            <p class="agent-share-gone-copy">
              The person who shared it stopped sharing it, or the link is not correct. Ask them for a new link.
            </p>
            <div class="agent-share-gone-actions">
              <ButtonLink to="/" variant="primary" size="lg" icon="open">
                Back to home
              </ButtonLink>
              <ButtonLink to="/download" variant="secondary" size="lg" icon="download">
                Download OpenBot
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
