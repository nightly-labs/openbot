import { createOpenBotAgentTemplateUrl } from "@openbot/contracts/agent-template-links";
import type { AgentTemplateDetail } from "@openbot/contracts/ipc";
import { createSignal, For, lazy, onSettled, Show } from "solid-js";
import { agentTemplatePath } from "../../lib/agent-template-path";
import { landingAnalytics } from "../../lib/analytics";
import { OPENBOT_LINKS } from "../../lib/landing-links";
import { ContentHeader } from "../content/ContentHeader";
import { PluginOpenButtons } from "../plugins/PluginOpenButtons";

// The Bloub library, which draws the avatar and owns its colours, uses browser-only APIs as soon as
// its module loads, so the Worker must never import it. The page loads both parts in the browser
// after hydration.
const AgentAvatar = lazy(() =>
  import("@openbot/ui/features/agents/AgentAvatar").then((module) => ({ default: module.AgentAvatar })),
);

export interface AgentTemplatePageProps {
  template: AgentTemplateDetail;
}

/**
 * One shared agent as a single card: the page a link on X or in a chat opens.
 *
 * The card is tinted with the agent's own avatar colour, so each shared agent looks like itself.
 * The button opens `openbot://agents/<id>`, built from the id, and the app then shows its own preview
 * with Install; nothing here installs.
 */
export function AgentTemplatePage(props: AgentTemplatePageProps) {
  // The Worker renders an empty box of the avatar's size, and the browser fills it in.
  const [mounted, setMounted] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  // Whether the clamp hid any text, measured once the page is in the browser.
  const [clamped, setClamped] = createSignal(false);
  // The avatar's colour tints the page; until it loads the page keeps the stylesheet's neutral one.
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

  const openUrl = () => createOpenBotAgentTemplateUrl(props.template.id);
  const counts = () =>
    [countLabel(props.template.skills.length, "skill"), countLabel(props.template.routines.length, "routine")].filter(
      (label): label is string => label !== null,
    );

  return (
    <div class="landing-page agent-share-page" style={accentStyle(accent())}>
      <ContentHeader />

      <main class="agent-share-main">
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

            <Show when={props.template.title || counts().length > 0}>
              <ul class="agent-share-tags" aria-label="About this agent">
                <Show when={props.template.title}>
                  <li class="agent-share-role">{props.template.title}</li>
                </Show>
                <For each={counts()}>{(label) => <li>{label}</li>}</For>
              </ul>
            </Show>

            <p ref={description} class="agent-share-description" data-expanded={expanded() ? "" : undefined}>
              {props.template.description}
            </p>
            <Show when={clamped()}>
              <button class="agent-share-more" type="button" onClick={() => setExpanded(!expanded())}>
                {expanded() ? "Show less" : "Read all instructions"}
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
          OpenBot didn't open? <a href={OPENBOT_LINKS.downloadFromOtherPage}>Download it</a> or{" "}
          <a href={openUrl()}>open the app</a>.
        </p>
      </main>
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
