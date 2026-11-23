import { createOpenBotAgentTemplateUrl, createWebAppAgentTemplatePath } from "@openbot/contracts/agent-template-links";
import type { AgentTemplateDetail } from "@openbot/contracts/ipc";
import { markdownPlainText, markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { Link } from "@tanstack/solid-router";
import { createMemo, createSignal, For, Loading, lazy, onSettled, Show } from "solid-js";
import { agentTemplatePath } from "../../lib/agent-template-path";
import { landingAnalytics } from "../../lib/analytics";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";
import { PluginOpenButtons } from "../plugins/PluginOpenButtons";

const AgentAvatar = lazy(() =>
  import("@openbot/ui/features/agents/AgentAvatar").then((module) => ({ default: module.AgentAvatar })),
);
const MarkdownMessageText = lazy(() =>
  import("@openbot/ui/features/conversation/MarkdownMessageText").then((module) => ({
    default: module.MarkdownMessageText,
  })),
);

export interface AgentTemplatePageProps {
  template: AgentTemplateDetail;
}

export function AgentTemplatePage(props: AgentTemplatePageProps) {
  const [mounted, setMounted] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [clamped, setClamped] = createSignal(false);
  const [accent, setAccent] = createSignal<string | null>(null);
  let description: HTMLParagraphElement | undefined;
  onSettled(() => {
    setMounted(true);
    void import("@openbot/brand/bloub-avatar").then(({ avatarHeadColor }) =>
      setAccent(avatarHeadColor(props.template.avatarSeed, props.template.avatarHue)),
    );
    if (description) setClamped(description.scrollHeight > description.clientHeight + 1);
    return landingAnalytics.start(document, window.location.hostname, agentTemplatePath(props.template.id));
  });

  const preview = createMemo(() => markdownPreviewText(props.template.description));
  const hasMore = () => clamped() || preview() !== props.template.description.replace(/\s+/gu, " ").trim();
  const openUrl = () => createOpenBotAgentTemplateUrl(props.template.id);
  const counts = () =>
    [countLabel(props.template.skills.length, "skill"), countLabel(props.template.routines.length, "routine")].filter(
      (label): label is string => label !== null,
    );

  return (
    <div class="landing-page agent-share-page" style={accentStyle(accent())}>
      <SiteHeader page="content" />

      <main class="agent-share-main">
        <div class="landing-hero-grid" aria-hidden="true" />
        <article class="agent-share-card" aria-labelledby="agent-share-name">
          <div class="agent-share-hero" aria-hidden="true">
            <Show when={mounted()} fallback={<span class="agent-share-avatar" />}>
              <AgentAvatar
                seed={props.template.avatarSeed}
                hue={props.template.avatarHue}
                url={props.template.avatarUrl}
                motion="always"
                class="agent-share-avatar"
              />
            </Show>
          </div>

          <div class="agent-share-body">
            <h1 class="agent-share-name" id="agent-share-name">
              {props.template.name}
            </h1>
            <p class="agent-share-creator">by {props.template.creatorName}</p>

            <Show when={counts().length > 0}>
              <ul class="agent-share-tags" aria-label="What this agent brings">
                <For each={counts()}>{(label) => <li>{label}</li>}</For>
              </ul>
            </Show>

            <Show
              when={expanded()}
              fallback={
                <p ref={description} class="agent-share-description">
                  {preview()}
                </p>
              }
            >
              <div class="agent-share-instructions message-markdown">
                <Loading
                  fallback={
                    <p class="agent-share-instructions-text">{markdownPlainText(props.template.description)}</p>
                  }
                >
                  <MarkdownMessageText
                    imagesAsLinks
                    linkFavicons={false}
                    body={props.template.description}
                    agents={[]}
                    onSelectAgent={() => undefined}
                    onOpenLink={(url) => window.open(url, "_blank", "noopener,noreferrer")}
                  />
                </Loading>
              </div>
            </Show>
            <Show when={hasMore()}>
              <button
                class="agent-share-more"
                type="button"
                aria-expanded={expanded() ? "true" : "false"}
                onClick={() => setExpanded(!expanded())}
              >
                {expanded() ? "Show less" : "Read more"}
              </button>
            </Show>

            <hr class="agent-share-divider" />
            <p class="agent-share-notice">Made by another OpenBot user. It can act on your behalf once added.</p>
            <div class="agent-share-action">
              <PluginOpenButtons
                href={openUrl()}
                label="Add to OpenBot"
                downloadCopy={`${props.template.name} is added from inside OpenBot. Get the app, then open this link again.`}
              />
            </div>
          </div>
        </article>

        <p class="agent-share-fallback">
          OpenBot didn't open? <Link to="/download">Download it</Link>, <a href={openUrl()}>open the app</a>, or{" "}
          <a href={createWebAppAgentTemplatePath(props.template.id)}>open in browser</a>.
        </p>
      </main>

      <LandingFooter />
    </div>
  );
}

function accentStyle(accent: string | null): Record<string, string> | undefined {
  return accent ? { "--agent-share-accent": accent } : undefined;
}

function countLabel(count: number, noun: string): string | null {
  if (count === 0) return null;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
