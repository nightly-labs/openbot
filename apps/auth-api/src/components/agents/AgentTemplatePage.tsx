import { createOpenBotAgentTemplateUrl } from "@openbot/contracts/agent-template-links";
import type { AgentTemplateDetail } from "@openbot/contracts/ipc";
import { routineScheduleSummary } from "@openbot/ui/features/conversation/routine-schedule-ui";
import { createSignal, For, lazy, onSettled, Show } from "solid-js";
import { agentTemplatePath } from "../../lib/agent-template-path";
import { landingAnalytics } from "../../lib/analytics";
import { ContentHeader } from "../content/ContentHeader";
import { LandingFooter } from "../landing/LandingFooter";
import { PluginOpenButtons } from "../plugins/PluginOpenButtons";
import { PluginRow, PluginSection } from "../plugins/PluginPage";

// The Bloub avatar uses browser-only APIs as soon as its module loads, so the Worker must never
// import it. The page loads it in the browser after hydration.
const AgentAvatar = lazy(() =>
  import("@openbot/ui/features/agents/AgentAvatar").then((module) => ({ default: module.AgentAvatar })),
);

export interface AgentTemplatePageProps {
  template: AgentTemplateDetail;
}

/**
 * One shared agent, as a visitor sees it before adding it to OpenBot.
 *
 * It uses the plugin page's parts. The button opens `openbot://agents/<id>`, built from the id, and
 * the app then shows its own preview with Install; nothing here installs. The instructions are
 * shown in full, because they are what the agent will do.
 */
export function AgentTemplatePage(props: AgentTemplatePageProps) {
  // The Worker renders an empty box of the avatar's size, and the browser fills it in.
  const [mounted, setMounted] = createSignal(false);
  onSettled(() => {
    setMounted(true);
    return landingAnalytics.start(document, window.location.hostname, agentTemplatePath(props.template.id));
  });

  return (
    <div class="landing-page post-article">
      <ContentHeader />

      <main class="post-main">
        <article class="post-container post-article-body">
          <header class="post-article-header" data-enter="post-copy">
            <div class="plugin-hero-row">
              <div class="plugin-hero-heading">
                {/* The avatar the agent has in the app: its photo, or the Bloub its seed and hue draw. */}
                <Show when={mounted()} fallback={<span class="agent-template-hero-avatar" aria-hidden="true" />}>
                  <AgentAvatar
                    seed={props.template.avatarSeed}
                    hue={props.template.avatarHue}
                    url={props.template.avatarUrl}
                    motion="idle"
                    class="agent-template-hero-avatar"
                  />
                </Show>
                <div class="plugin-hero-text">
                  <h1 class="post-article-title">{props.template.name}</h1>
                  <p class="post-article-standfirst plugin-hero-standfirst">By {props.template.creatorName}</p>
                </div>
              </div>
              <PluginOpenButtons
                href={createOpenBotAgentTemplateUrl(props.template.id)}
                label="Add to OpenBot"
                downloadCopy={`${props.template.name} is added from inside OpenBot. Get the app, then open this link again.`}
              />
            </div>
          </header>

          <div class="plugin-body" data-enter="post-prose">
            <Show when={props.template.title}>
              <p class="plugin-description">{props.template.title}</p>
            </Show>
            <p class="plugin-description agent-template-instructions">{props.template.description}</p>

            <Show when={props.template.skills.length > 0}>
              <PluginSection id="agent-skills-title" title="Skills" count={props.template.skills.length}>
                <ul class="plugin-rows">
                  <For each={props.template.skills}>
                    {(skill) => (
                      <PluginRow
                        icon="blocks"
                        title={skill.name}
                        description={skill.kind === "marketplace" ? "Marketplace skill" : "Included skill"}
                      />
                    )}
                  </For>
                </ul>
              </PluginSection>
            </Show>

            <Show when={props.template.routines.length > 0}>
              <PluginSection id="agent-routines-title" title="Routines" count={props.template.routines.length}>
                <ul class="plugin-rows">
                  <For each={props.template.routines}>
                    {(routine) => (
                      <PluginRow
                        icon="puzzle"
                        title={routine.name}
                        description={routineScheduleSummary(routine.schedule)}
                      />
                    )}
                  </For>
                </ul>
              </PluginSection>
            </Show>
          </div>
        </article>
      </main>

      <LandingFooter />
    </div>
  );
}
