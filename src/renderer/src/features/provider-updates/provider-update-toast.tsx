import { ProviderLogo } from "@openbot/brand";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { Button, Progress, TOAST_DURATION, toast } from "@openbot/ui";
import { createDigitRoll } from "@openbot/ui/digit-roll";
import {
  type ProviderUpdate,
  type ProviderUpdatePresentation,
  presentProviderUpdate,
} from "@openbot/ui/features/provider-updates/provider-update";
import { currentText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createUniqueId,
  getOwner,
  onSettled,
  runWithOwner,
  Show,
  untrack,
} from "solid-js";

const PERSISTENT = Number.POSITIVE_INFINITY;

function toastId(provider: AgentProviderId): string {
  return `provider-update-${provider}`;
}

function providerIcon(provider: AgentProviderId): JSX.Element {
  return <ProviderLogo provider={provider} class="provider-update-toast-logo" />;
}

function ProviderUpdatePercent(props: { percent: number }): JSX.Element {
  const roll = createDigitRoll(() => props.percent);

  return (
    <span ref={roll.ref} class="provider-update-toast-percent t-digit-group" aria-hidden="true">
      <span class="t-digit">{roll.displayed()}%</span>
    </span>
  );
}

function ProviderUpdateDetail(props: {
  provider: AgentProviderId;
  presentation: ProviderUpdatePresentation;
  expanded: boolean;
  clamped: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onClampedChange: (clamped: boolean) => void;
}): JSX.Element {
  const { t } = currentText();
  const lineId = createUniqueId();
  let line: HTMLSpanElement | undefined;

  function measure(failed: boolean, expanded: boolean): void {
    if (!line || expanded) return;
    props.onClampedChange(failed && line.scrollHeight > line.clientHeight);
  }

  createEffect(
    () => ({
      detail: props.presentation.detail,
      failed: props.presentation.failed,
      expanded: props.expanded,
    }),
    (state) => measure(state.failed, state.expanded),
  );
  onSettled(() => {
    if (!line || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure(props.presentation.failed, props.expanded));
    observer.observe(line);
    return () => observer.disconnect();
  });

  return (
    <>
      <span
        ref={(element) => (line = element)}
        id={lineId}
        class="provider-update-toast-line"
        data-failed={props.presentation.failed ? "true" : undefined}
        data-expanded={props.expanded ? "true" : undefined}
      >
        {props.presentation.detail}
      </span>
      <Show when={props.presentation.failed && (props.clamped || props.expanded)}>
        <Button
          variant="link"
          size="xs"
          class="provider-update-toast-details"
          aria-expanded={props.expanded ? "true" : "false"}
          aria-controls={lineId}
          onClick={() => props.onExpandedChange(!props.expanded)}
        >
          {props.expanded ? t("update.provider.hideDetails") : t("update.provider.showDetails")}
        </Button>
      </Show>
      <Show when={props.presentation.busy}>
        <span class="provider-update-toast-progress">
          <Progress
            class="provider-update-toast-bar"
            data-provider={props.provider}
            value={props.presentation.progress ?? 0}
            indeterminate={props.presentation.progress === null}
            aria-label={props.presentation.title}
          />
          <Show when={props.presentation.progress !== null}>
            <ProviderUpdatePercent percent={props.presentation.progress ?? 0} />
          </Show>
        </span>
      </Show>
    </>
  );
}

function ProviderUpdateActionLabel(props: { presentation: ProviderUpdatePresentation }): JSX.Element {
  return (
    <span class="provider-update-toast-action" data-idle={props.presentation.actionLabel ? undefined : "true"}>
      {props.presentation.actionLabel}
    </span>
  );
}

function samePresentation(a: ProviderUpdatePresentation, b: ProviderUpdatePresentation): boolean {
  return (
    a.updatable === b.updatable &&
    a.busy === b.busy &&
    a.failed === b.failed &&
    a.actionLabel === b.actionLabel &&
    a.title === b.title &&
    a.detail === b.detail &&
    a.progress === b.progress
  );
}

interface LiveProviderUpdateToast {
  present: (update: ProviderUpdate) => void;
  setAct: (act: () => void) => void;
  setOffer: (version: string | null) => void;
}

const liveToasts = new Map<AgentProviderId, LiveProviderUpdateToast>();
const dismissTimers = new Map<AgentProviderId, number>();
const disposers = new Map<AgentProviderId, () => void>();
const notificationsOwner = createRoot(() => getOwner());
const closedOffers = new Map<AgentProviderId, string>();

function releaseProviderUpdateToast(provider: AgentProviderId): void {
  const timer = dismissTimers.get(provider);
  if (timer !== undefined) window.clearTimeout(timer);
  dismissTimers.delete(provider);
  liveToasts.delete(provider);
  disposers.get(provider)?.();
  disposers.delete(provider);
}

function liveToast(provider: AgentProviderId, update: ProviderUpdate): LiveProviderUpdateToast {
  const open = liveToasts.get(provider);
  if (open) return open;

  const parts = runWithOwner(notificationsOwner, () =>
    createRoot((dispose) => {
      const [latest, setLatest] = createSignal(update);
      const current = createMemo(() => presentProviderUpdate(latest()), { equals: samePresentation });
      const layout = createMemo(() => {
        const { title, detail, busy, failed, progress, actionLabel } = current();
        return JSON.stringify([title, detail, busy, failed, progress === null, actionLabel ?? null]);
      });
      const [clamped, setClamped] = createSignal(false);
      const [expanded, setExpanded] = createSignal(false);
      let act = (): void => {};
      let offered: string | null = null;

      const live: LiveProviderUpdateToast = {
        present: (nextUpdate) => {
          const previous = untrack(current);
          const next = presentProviderUpdate(nextUpdate);
          setLatest(nextUpdate);
          if (!next.failed || next.detail !== previous.detail) setExpanded(false);
        },
        setAct: (next) => {
          act = next;
        },
        setOffer: (version) => {
          offered = version;
        },
      };
      liveToasts.set(provider, live);
      disposers.set(provider, dispose);

      return {
        live,
        offeredVersion: () => offered,
        title: () => {
          clamped();
          expanded();
          layout();
          return untrack(current).title;
        },
        icon: providerIcon(provider),
        description: (
          <ProviderUpdateDetail
            provider={provider}
            presentation={current()}
            expanded={expanded()}
            clamped={clamped()}
            onExpandedChange={setExpanded}
            onClampedChange={setClamped}
          />
        ),
        label: <ProviderUpdateActionLabel presentation={current()} />,
        onClick: (event: MouseEvent) => {
          event.preventDefault();
          act();
        },
      };
    }),
  );

  toast(parts.title, {
    id: toastId(provider),
    class: "provider-update-toast",
    icon: parts.icon,
    description: parts.description,
    action: { label: parts.label, onClick: parts.onClick },
    duration: PERSISTENT,
    onDismiss: () => {
      if (liveToasts.get(provider) !== parts.live) return;
      const closed = parts.offeredVersion();
      if (closed) closedOffers.set(provider, closed);
      releaseProviderUpdateToast(provider);
    },
  });

  return parts.live;
}

export function showProviderUpdateToast(update: ProviderUpdate, onUpdate: () => void): void {
  const timer = dismissTimers.get(update.provider);
  if (timer !== undefined) window.clearTimeout(timer);
  dismissTimers.delete(update.provider);
  const presentation = presentProviderUpdate(update);
  const live = liveToast(update.provider, update);
  live.present(update);
  live.setAct(onUpdate);
  live.setOffer(presentation.updatable ? update.availableVersion : null);
}

export function providerUpdateOfferClosed(provider: AgentProviderId, availableVersion: string | null): boolean {
  return availableVersion !== null && closedOffers.get(provider) === availableVersion;
}

export function hideProviderUpdateToast(provider: AgentProviderId): void {
  toast.dismiss(toastId(provider));
  releaseProviderUpdateToast(provider);
}

export function reportProviderUpdateToast(update: ProviderUpdate, onRetry: () => void): void {
  const live = liveToasts.get(update.provider);
  if (!live) return;
  const presentation = presentProviderUpdate(update);
  live.present(update);
  live.setAct(onRetry);
  live.setOffer(presentation.updatable ? update.availableVersion : null);

  const timer = dismissTimers.get(update.provider);
  if (timer !== undefined) window.clearTimeout(timer);
  dismissTimers.delete(update.provider);
  if (presentation.busy || presentation.failed) return;

  dismissTimers.set(
    update.provider,
    window.setTimeout(() => dismissProviderUpdateToast(update.provider), TOAST_DURATION),
  );
}

export function dismissProviderUpdateToast(provider: AgentProviderId): void {
  closedOffers.delete(provider);
  hideProviderUpdateToast(provider);
}
