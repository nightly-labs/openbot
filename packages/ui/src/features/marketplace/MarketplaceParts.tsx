import type { MarketplaceSkillSummary } from "@openbot/contracts/ipc";
import {
  ArrowRight,
  Button,
  Check,
  ErrorReference,
  Heading,
  IconButton,
  Plug,
  Puzzle,
  Sparkles,
  Text,
} from "@openbot/ui";
import { ReferenceChip } from "@openbot/ui/reference-chip";
import { SkillGradient } from "@openbot/ui/skill-gradient";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { GitHubMark, LogoTile, OnePasswordMark } from "../settings/IntegrationLayout";
import type { MarketplaceApp } from "./marketplace-model";

/** The top of an agent or skill page. The window moves the focus to the title when the page opens. */
export function PageHead(props: { media: JSX.Element; title: string; description: string; actions?: JSX.Element }) {
  return (
    <div class="marketplace-head">
      {props.media}
      <div class="marketplace-head-copy">
        <Heading as="h3" size="lg" class="marketplace-page-title">
          {props.title}
        </Heading>
        <Text as="p" variant="body-sm" tone="muted">
          {props.description}
        </Text>
      </div>
      {props.actions}
    </div>
  );
}

/** The part of a page that waits for the full listing: a status line, or the failure with Retry. */
export function DetailState(props: {
  status: "loading" | "loaded" | "failed";
  /** The code of the failed read, when it has one. */
  reference?: string | null | undefined;
  loadingLabel: string;
  onRetry: () => void;
  children: JSX.Element;
}) {
  const { t } = useText();
  return (
    <Switch>
      <Match when={props.status === "loading"}>
        <Text as="p" variant="body-sm" tone="muted" role="status">
          {props.loadingLabel}
        </Text>
      </Match>
      <Match when={props.status === "failed"}>
        <div class="marketplace-empty" role="alert">
          <Text as="p" variant="body-sm" tone="muted">
            {t("marketplace.loadFailed")}
          </Text>
          <ErrorReference reference={props.reference} />
          <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      </Match>
      <Match when={props.status === "loaded"}>{props.children}</Match>
    </Switch>
  );
}

/** A titled part of a page. */
export function Block(props: {
  id: string;
  level: "h3" | "h4";
  title: string;
  description?: string;
  aside?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section class="marketplace-block" aria-labelledby={props.id}>
      <div class="marketplace-block-head">
        <div class="marketplace-block-copy">
          <Heading as={props.level} size="sm" id={props.id}>
            {props.title}
          </Heading>
          <Show when={props.description}>
            <Text variant="caption" tone="muted">
              {props.description}
            </Text>
          </Show>
        </div>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

/**
 * The facts column of a page. `dt` and `dd` stay direct children of the list: axe rejects a wrapper
 * per row.
 */
export function Properties(props: { label: string; items: readonly { label: string; value: JSX.Element }[] }) {
  return (
    <aside class="marketplace-side" aria-label={props.label}>
      <dl class="marketplace-props">
        <For each={props.items}>
          {(entry) => (
            <>
              <dt>
                <Text as="span" variant="caption" tone="muted">
                  {entry.label}
                </Text>
              </dt>
              <dd>
                <Text as="span" variant="body-sm">
                  {entry.value}
                </Text>
              </dd>
            </>
          )}
        </For>
      </dl>
    </aside>
  );
}

/** A state that has no action: "Added", "Connected". */
export function Done(props: { children: JSX.Element }) {
  return (
    <span class="marketplace-done">
      <Check aria-hidden="true" />
      {props.children}
    </span>
  );
}

export function MenuCheck(props: { on: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.on ? "" : undefined}>
      <Show when={props.on}>
        <Check aria-hidden="true" />
      </Show>
    </span>
  );
}

/** A skill's own icon, or a spark when it has none or the icon does not load. "row" is the tile of a list row. */
export function SkillMark(props: { skill: Pick<MarketplaceSkillSummary, "iconUrl">; size: "sm" | "row" | "md" }) {
  const [failed, setFailed] = createSignal<string | null>(null);
  const url = () => (props.skill.iconUrl && props.skill.iconUrl !== failed() ? props.skill.iconUrl : null);
  return (
    <span class="marketplace-skill-mark" data-size={props.size} data-kind={url() ? "icon" : "none"} aria-hidden="true">
      <SkillIcon url={url()} onError={setFailed} />
    </span>
  );
}

/** A skill's icon, or the sparkles when it has none or the icon does not load. */
export function SkillIcon(props: { url: string | null | undefined; onError?: (url: string) => void }) {
  const [failed, setFailed] = createSignal<string | null>(null);
  const url = () => (props.url && props.url !== failed() ? props.url : null);
  return (
    <Show when={url()} fallback={<Sparkles />} keyed>
      {(src) => (
        <img
          src={src}
          alt=""
          onError={() => {
            setFailed(src);
            props.onError?.(src);
          }}
        />
      )}
    </Show>
  );
}

/** The mark of an app, without its tile. */
export function AppMark(props: { app: MarketplaceApp }) {
  const [failed, setFailed] = createSignal<string | null>(null);
  const url = () => {
    const app = props.app;
    const icon = app.kind === "plugin" ? app.plugin.iconUrl : null;
    return icon && icon !== failed() ? icon : null;
  };
  return (
    <Switch fallback={<Puzzle aria-hidden="true" />}>
      <Match when={props.app.kind === "github"}>
        <GitHubMark />
      </Match>
      <Match when={props.app.kind === "onepassword"}>
        <OnePasswordMark />
      </Match>
      <Match when={url()} keyed>
        {(src) => <img src={src} alt="" onError={() => setFailed(src)} />}
      </Match>
      <Match when={props.app.kind === "custom"}>
        <Plug aria-hidden="true" />
      </Match>
    </Switch>
  );
}

/** The mark of an app, on its tile. */
export function AppLogo(props: { app: MarketplaceApp; size?: "md" | "lg" }) {
  return (
    <LogoTile size={props.size ?? "md"}>
      <AppMark app={props.app} />
    </LogoTile>
  );
}

/**
 * Example requests on the listing's gradient, each with a Try arrow. The caption says why the arrows
 * are off.
 */
export function TryCard(props: {
  seed: string;
  chip: { kind: "agent" | "skill" | "plugin"; name: string; icon: JSX.Element };
  requests: readonly { id: string; text: string }[];
  tryLabel: (request: string) => string;
  onTry?: ((id: string) => void) | undefined;
  caption?: string | undefined;
}) {
  return (
    <div class="marketplace-try">
      <div class="skill-preview-card marketplace-try-card">
        <SkillGradient name={props.seed} />
        <For each={props.requests}>
          {(request) => (
            <div class="skill-preview-request">
              <p>
                <ReferenceChip
                  kind={props.chip.kind}
                  name={props.chip.name}
                  icon={props.chip.icon}
                  class="skill-preview-chip"
                />{" "}
                {request.text}
              </p>
              <IconButton
                label={props.tryLabel(request.text)}
                size="icon-lg"
                variant="ghost"
                disabled={!props.onTry}
                onClick={() => props.onTry?.(request.id)}
              >
                <ArrowRight />
              </IconButton>
            </div>
          )}
        </For>
      </div>
      <Show when={props.caption}>
        {(caption) => (
          <Text as="p" variant="body-sm" tone="muted">
            {caption()}
          </Text>
        )}
      </Show>
    </div>
  );
}
