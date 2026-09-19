import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { matchesPluginTags, PLUGIN_INDEX_ROUTE, SITE_PLUGINS } from "../../lib/plugins";
import { ContentHeader } from "../content/ContentHeader";
import { createLandingReveal } from "../landing/createLandingReveal";
import { LandingFooter } from "../landing/LandingFooter";
import { PluginCard } from "./PluginCard";
import { PluginTagFilters } from "./PluginTagFilters";

/**
 * The index. The title block is one word, the same way the collection pages give theirs almost
 * nothing: the cards say what the page holds better than a paragraph above them can, and the
 * sentence that used to sit here still does its real work in the page description.
 */
export function PluginsIndexPage() {
  let grid: HTMLElement | undefined;
  const [selected, setSelected] = createSignal<readonly string[]>([]);
  const shown = createMemo(() => SITE_PLUGINS.filter((plugin) => matchesPluginTags(plugin, selected())));

  const toggle = (label: string) =>
    setSelected((tags) => (tags.includes(label) ? tags.filter((tag) => tag !== label) : [...tags, label]));

  // No inset margin, the same reason the article grid gives: the first row is already on screen
  // when the page loads, and a card that is visible must not wait for a scroll that never comes.
  const revealed = createLandingReveal(() => grid, { rootMargin: "0px" });

  onSettled(() => landingAnalytics.start(document, window.location.hostname, PLUGIN_INDEX_ROUTE));

  return (
    <div class="landing-page plugin-index">
      <ContentHeader />

      <main class="post-main">
        <div class="post-container">
          <div class="plugin-intro" data-enter="post-copy">
            <h1 class="plugin-intro-title">Plugins</h1>
          </div>

          <section
            ref={grid}
            class="plugin-grid-section"
            aria-labelledby="plugin-grid-title"
            data-revealed={revealed() ? "true" : "false"}
          >
            <h2 class="landing-visually-hidden" id="plugin-grid-title">
              All plugins
            </h2>
            <PluginTagFilters selected={selected} onToggle={toggle} onClear={() => setSelected([])} />
            {/* The count is announced rather than drawn: a reader who cannot see the grid change has
                no other way to tell that pressing a tag did anything. */}
            <p class="landing-visually-hidden" role="status">
              {shown().length} of {SITE_PLUGINS.length} plugins
            </p>
            <div class="plugin-grid">
              <For each={shown()}>{(plugin, index) => <PluginCard plugin={plugin} index={index()} />}</For>
            </div>
            <Show when={shown().length === 0}>
              <p class="plugin-empty">No plugin carries every tag you picked.</p>
            </Show>
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
