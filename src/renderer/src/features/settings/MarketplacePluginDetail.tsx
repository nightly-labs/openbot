/**
 * The page one plugin gets in the marketplace.
 *
 * `MarketplaceDetail` is a tabbed shell - a left nav that swaps one measured panel - which suits an
 * agent, whose instructions, skills and routines are three answers to three questions. A plugin is
 * read top to bottom instead: what it is, what it can be asked, what it brings, and who published
 * it. So this is a sibling page rather than another mode on that component, and it keeps the
 * `marketplace-detail-page` class so the detail layer's padding, focus and width still apply.
 *
 * The example requests are the skill preview's card, gradient and row, not a second look-alike: a
 * plugin's examples and a skill's example are the same offer, so they read the same way.
 */

import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
  ArrowRight,
  Badge,
  Blocks,
  Button,
  ExternalLink,
  Heading,
  IconButton,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2,
  Puzzle,
  Text,
} from "../../components/ui";
import { ReferenceChip } from "../../components/ui/reference-chip";
import { SkillGradient } from "../../components/ui/skill-gradient";
import { AgentSelect } from "./AgentSelect";
import { CATEGORY_LABELS } from "./MarketplaceCatalog";
import type { MarketplacePluginPrompt, MarketplacePluginDetail as PluginDetail } from "./marketplace-plugins";

/**
 * A listing icon, falling back to a mark when the art is missing or fails to load - the same
 * fallback the skill card uses, so a plugin with no icon reads as a listing rather than as a hole.
 */
export function PluginIcon(props: { iconUrl: string | null; fallback?: "plugin" | "skill"; class?: string }) {
  const [failedUrl, setFailedUrl] = createSignal<string | null>(null);
  const iconUrl = createMemo(() => {
    const url = props.iconUrl;
    return url && failedUrl() !== url ? url : null;
  });
  return (
    <span class={props.class ? `skills-marketplace-icon ${props.class}` : "skills-marketplace-icon"}>
      <Show when={iconUrl()} fallback={props.fallback === "skill" ? <Blocks /> : <Puzzle />} keyed>
        {(url) => <img src={url} alt="" onError={() => setFailedUrl(url)} />}
      </Show>
    </span>
  );
}

/**
 * What a link row shows: the address without the scheme and the `www.` a reader does not need. The
 * path stays, because a listing's three links usually differ only there.
 */
function linkText(url: string) {
  try {
    const { host, pathname } = new URL(url);
    return `${host.replace(/^www\./, "")}${pathname === "/" ? "" : pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

/**
 * A counted section heading over the hairline its rows hang from. The count is in the region's name
 * as well as on screen, because "Skills" and "Skills 5" are different amounts of information.
 */
function PluginSection(props: { title: string; count: number; children: JSX.Element }) {
  return (
    <section class="marketplace-plugin-section" aria-label={`${props.title}, ${props.count}`}>
      <div class="marketplace-plugin-section-title">
        <Heading as="h2" size="sm">
          {props.title}
        </Heading>
        <Badge class="marketplace-plugin-section-count" aria-hidden="true">
          {props.count}
        </Badge>
      </div>
      {props.children}
    </section>
  );
}

export function MarketplacePluginDetail(props: {
  plugin: PluginDetail;
  /** The agents an install can go to, as on the skill page: a plugin lands on one agent. */
  agents: Array<{ id: string; name: string }>;
  targetAgentId: string;
  onTargetChange: (id: string) => void;
  installed?: boolean;
  busy?: boolean;
  onInstall: () => void | Promise<void>;
  /**
   * Takes the plugin back off this computer. Offered in the install button's own place rather than
   * beside it: a listing is installed or it is not, and the one control says which and offers the
   * other. What is about to be removed is named in the confirmation the caller opens, not here.
   */
  onUninstall: () => void | Promise<void>;
  /**
   * Given only where the copied address leads somewhere. `openbot.run/plugins/<slug>` is not served
   * yet, so the app withholds the button rather than hand out a link that answers 404.
   */
  onCopyLink?: () => void | Promise<void>;
  /** Given only where a prompt can actually be sent somewhere; without it the arrows are disabled. */
  onRunPrompt?: (prompt: MarketplacePluginPrompt) => void;
  onOpenUrl: (url: string) => void;
}) {
  /* The name a reader hears carries the visible host, so the row is not three times "Open link". */
  const links = createMemo(() =>
    [
      { label: "Website", url: props.plugin.websiteUrl },
      { label: "Privacy Policy", url: props.plugin.privacyPolicyUrl },
      { label: "Terms of Service", url: props.plugin.termsUrl },
    ]
      .filter((link): link is { label: string; url: string } => Boolean(link.url))
      .map((link) => ({ ...link, text: linkText(link.url), name: `${link.label}: ${linkText(link.url)}` })),
  );

  return (
    <section class="marketplace-detail-page marketplace-plugin-detail" aria-label={`${props.plugin.name} details`}>
      <div class="marketplace-plugin-heading">
        <PluginIcon iconUrl={props.plugin.iconUrl} />
        <div class="marketplace-plugin-heading-copy">
          <h1>{props.plugin.name}</h1>
          <Text as="p" tone="secondary">
            {props.plugin.tagline}
          </Text>
        </div>
        <div class="marketplace-plugin-heading-actions">
          <Show when={props.onCopyLink}>
            {(copyLink) => (
              <Button class="marketplace-plugin-share" variant="outline" onClick={() => void copyLink()()}>
                <Link2 aria-hidden="true" />
                Copy link
              </Button>
            )}
          </Show>
          {/* The target and the install share one control, as they do on a skill page: the page
              states which agent gets the plugin and sends it there in the same place. */}
          <div class="marketplace-install-control">
            <AgentSelect agents={props.agents} value={props.targetAgentId} onChange={props.onTargetChange} />
            <Show
              when={props.installed}
              fallback={
                <Button loading={props.busy} disabled={!props.targetAgentId} onClick={() => void props.onInstall()}>
                  Install plugin
                </Button>
              }
            >
              <Button variant="destructive" loading={props.busy} onClick={() => void props.onUninstall()}>
                Uninstall plugin
              </Button>
            </Show>
          </div>
        </div>
      </div>

      <Show when={props.plugin.prompts.length > 0}>
        <div class="skill-preview-card marketplace-plugin-prompts">
          <SkillGradient name={props.plugin.name} />
          <ul>
            <For each={props.plugin.prompts}>
              {(prompt) => (
                <li class="skill-preview-request marketplace-plugin-prompt">
                  <p>
                    <ReferenceChip
                      kind="plugin"
                      name={props.plugin.name}
                      class="skill-preview-chip"
                      /* The chip's own icon slot is 16px, so it takes the art directly rather than
                         the listing icon, which carries the 42px listing box with it. */
                      icon={
                        <Show when={props.plugin.iconUrl} fallback={<Puzzle />} keyed>
                          {(url) => <img src={url} alt="" />}
                        </Show>
                      }
                    />{" "}
                    {prompt.text}
                  </p>
                  <IconButton
                    label={`Ask ${props.plugin.name}: ${prompt.text}`}
                    size="icon-lg"
                    variant="ghost"
                    disabled={!props.onRunPrompt}
                    onClick={() => props.onRunPrompt?.(prompt)}
                  >
                    <ArrowRight />
                  </IconButton>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <p class="marketplace-detail-lead">{props.plugin.description}</p>

      <Show when={props.plugin.apps.length > 0}>
        <PluginSection title="Apps" count={props.plugin.apps.length}>
          <ItemGroup surface="subtle">
            <For each={props.plugin.apps}>
              {(app) => (
                <Item>
                  <ItemMedia>
                    <PluginIcon iconUrl={app.iconUrl} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{app.name}</ItemTitle>
                    <ItemDescription class="marketplace-plugin-row-description">{app.description}</ItemDescription>
                  </ItemContent>
                </Item>
              )}
            </For>
          </ItemGroup>
        </PluginSection>
      </Show>

      <Show when={props.plugin.skills.length > 0}>
        <PluginSection title="Skills" count={props.plugin.skills.length}>
          <ItemGroup surface="subtle">
            <For each={props.plugin.skills}>
              {(skill) => (
                <Item>
                  <ItemMedia>
                    <PluginIcon iconUrl={null} fallback="skill" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{skill.slug}</ItemTitle>
                    <ItemDescription class="marketplace-plugin-row-description">{skill.description}</ItemDescription>
                  </ItemContent>
                </Item>
              )}
            </For>
          </ItemGroup>
        </PluginSection>
      </Show>

      <PluginSection title="Information" count={3 + links().length}>
        {/* `dt` and `dd` stay direct children of the list: axe rejects a wrapper per row, so the two
            columns come from the grid on the list itself. */}
        <dl class="marketplace-plugin-information">
          <dt>
            <Text tone="muted">Developer</Text>
          </dt>
          <dd>
            <Text>{props.plugin.creatorName}</Text>
          </dd>
          <dt>
            <Text tone="muted">Category</Text>
          </dt>
          <dd>
            <Text>{CATEGORY_LABELS[props.plugin.category]}</Text>
          </dd>
          <dt>
            <Text tone="muted">Version</Text>
          </dt>
          <dd>
            <Text>{props.plugin.version}</Text>
          </dd>
          <For each={links()}>
            {(link) => (
              <>
                <dt>
                  <Text tone="muted">{link.label}</Text>
                </dt>
                <dd>
                  <Button
                    class="marketplace-plugin-link"
                    variant="link"
                    aria-label={link.name}
                    onClick={() => props.onOpenUrl(link.url)}
                  >
                    {link.text}
                    <ExternalLink aria-hidden="true" />
                  </Button>
                </dd>
              </>
            )}
          </For>
        </dl>
      </PluginSection>
    </section>
  );
}
