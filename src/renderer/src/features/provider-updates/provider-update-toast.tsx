import { ProviderLogo } from "@openbot/brand";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createEffect, createRoot, createSignal, onCleanup, Show, untrack } from "solid-js";
import { Progress, TOAST_DURATION, toast } from "../../components/ui";
import { type ProviderUpdate, type ProviderUpdatePresentation, presentProviderUpdate } from "./provider-update";

/**
 * The provider update, as one notification the user acts on and then watches.
 *
 * The notification is raised once and held for the whole flow. This is the point of the module:
 * calling `toast()` a second time with the same id does not edit what is on screen, it reconciles
 * the store entry, and Solid rebuilds the list row from it. The `<li>` is thrown away for a new one
 * that mounts at zero height with the enter animation, and a download that reports every hundred
 * milliseconds does that a dozen times a second - which is the jumping this module exists to avoid.
 *
 * So everything that changes after the notification opens is a signal read inside the element that
 * is already there. The title is a function sonner calls again, and the detail and the action button
 * are elements built once, in their own reactive root, that update themselves in place.
 *
 * Two things follow from holding one toast open. Its dismiss timer cannot be re-armed, so the
 * settled notification counts itself out here. And the action button is ours rather than sonner's,
 * because sonner renders its own button for as long as an action exists, and an update that has
 * finished has nothing left to offer.
 *
 * The Toaster is already mounted once in `App.tsx`, outside every provider, and `toast` is the
 * handle onto it.
 */

/** Sonner starts no dismiss timer for `POSITIVE_INFINITY`, which is what "held" means above. */
const PERSISTENT = Number.POSITIVE_INFINITY;

function toastId(provider: AgentProviderId): string {
  return `provider-update-${provider}`;
}

/**
 * The mark the provider row already shows, in the slot a toast keeps for a status glyph.
 *
 * Three providers can offer an update, so which one this is deserves to be the first thing read, and
 * a check mark on the success would say nothing the title does not. It carries its own brand colour,
 * which is also why nothing here uses `toast.success` or `toast.error`: the only thing a toast type
 * changes in this design system is the tint of the icon a provider mark has replaced.
 */
function providerIcon(provider: AgentProviderId): JSX.Element {
  return <ProviderLogo provider={provider} class="provider-update-toast-logo" />;
}

/** Batch rapid progress events so the number has time to settle between changes.
 * The progressbar still reports the current value to assistive technology.
 */
function ProviderUpdatePercent(props: { percent: number }): JSX.Element {
  const [displayed, setDisplayed] = createSignal(untrack(() => props.percent));
  let latest = untrack(() => props.percent);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let digitGroup: HTMLSpanElement | undefined;

  createEffect(
    () => props.percent,
    (percent) => {
      latest = percent;
      if (timer !== undefined || percent === untrack(displayed)) return;
      // Use the newest value, not a queue of obsolete download events.
      timer = setTimeout(() => {
        timer = undefined;
        setDisplayed(latest);
      }, 400);
    },
  );
  onCleanup(() => clearTimeout(timer));

  createEffect(displayed, () => {
    if (!digitGroup) return;
    digitGroup.classList.remove("is-animating");
    void digitGroup.offsetHeight;
    digitGroup.classList.add("is-animating");
  });

  return (
    <span ref={digitGroup} class="provider-update-toast-percent t-digit-group" aria-hidden="true">
      <span class="t-digit">{displayed()}%</span>
    </span>
  );
}

/**
 * What is under the title: one line that names the state, and - while the update is running - the
 * bar that reports it.
 *
 * The bar takes the row the action button occupies in every other state, so the box a user pressed
 * Update on answers in the same place, and the reserved row is never empty. Downloading fills the
 * bar to the percentage beside it; "Setting up" has no measurable end, so the bar is indeterminate
 * and the percentage goes away rather than sitting at a number that has stopped moving.
 */
function ProviderUpdateDetail(props: {
  provider: AgentProviderId;
  presentation: ProviderUpdatePresentation;
}): JSX.Element {
  return (
    <>
      <span class="provider-update-toast-line">{props.presentation.detail}</span>
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

/**
 * What the one button says - start the update, or try the failed one again - while it stays the same
 * button, so that nothing under the reader is rebuilt to change a word.
 *
 * A state with nothing to offer leaves a marker instead of a word, and `provider-updates.css` takes
 * the button out of the layout when it finds one. Sonner renders its action button for as long as an
 * action exists, and an action it has been given cannot be taken away without replacing the whole
 * notification; hiding it is what a finished update needs, and it also keeps a button with no name
 * out of the accessibility tree.
 */
function ProviderUpdateActionLabel(props: { presentation: ProviderUpdatePresentation }): JSX.Element {
  return (
    <span class="provider-update-toast-action" data-idle={props.presentation.actionLabel ? undefined : "true"}>
      {props.presentation.actionLabel}
    </span>
  );
}

/** The notification open for one provider, and the three things about it that still move. */
interface LiveProviderUpdateToast {
  present: (presentation: ProviderUpdatePresentation) => void;
  setAct: (act: () => void) => void;
  setOffer: (version: string | null) => void;
}

const liveToasts = new Map<AgentProviderId, LiveProviderUpdateToast>();
const dismissTimers = new Map<AgentProviderId, number>();
const disposers = new Map<AgentProviderId, () => void>();
/**
 * The version each provider's notification was closed on by the user.
 *
 * It lives here because this module outlives the runtime store, which is rebuilt for every server
 * the user opens: without it, opening a team workspace and coming back raises an offer the user has
 * already closed. It is keyed by version, so the next version is a new offer and is announced.
 */
const closedOffers = new Map<AgentProviderId, string>();

/**
 * Forget the notification, whether it was dismissed from here or closed by the user.
 *
 * Sonner calls this back for both, so the reactive root that owns the detail and the button is
 * disposed exactly once, and the next update opens a new notification instead of writing into one
 * that has left the screen.
 */
function releaseProviderUpdateToast(provider: AgentProviderId): void {
  const timer = dismissTimers.get(provider);
  if (timer !== undefined) window.clearTimeout(timer);
  dismissTimers.delete(provider);
  liveToasts.delete(provider);
  disposers.get(provider)?.();
  disposers.delete(provider);
}

/**
 * Open the notification, or hand back the one already open.
 *
 * The root is explicit because the caller is an effect over the provider snapshot: owned by it,
 * these elements would be disposed by the next snapshot that arrives.
 *
 * The root builds the parts and nothing else. Raising the toast is a write to the Toaster's store,
 * and Solid allows a write from an effect - the node carries `CONFIG_CHILDREN_FORBIDDEN`, which is
 * what marks the sanctioned place for a side effect - but not from a plain owner such as this root.
 * Calling `toast()` inside it throws `REACTIVE_WRITE_IN_OWNED_SCOPE` and halts the reactive system
 * for the whole page. It is a write the second notification makes and the first does not: the store
 * only notifies the properties something has already read, and on an empty Toaster there are none
 * yet. So the parts are built here and handed back, and the caller raises the notification.
 */
function liveToast(provider: AgentProviderId, presentation: ProviderUpdatePresentation): LiveProviderUpdateToast {
  const open = liveToasts.get(provider);
  if (open) return open;

  const parts = createRoot((dispose) => {
    const [current, setCurrent] = createSignal(presentation);
    // Read at click time, so the button that offered the update is the button that retries it.
    let act = (): void => {};
    let offered: string | null = null;

    const live: LiveProviderUpdateToast = {
      present: (next) => setCurrent(next),
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
      // The title is the one thing given as a function. Sonner re-measures the toast whenever the
      // title or the description changes, and the other two are elements that keep their identity
      // for the whole flow, so this read of the signal is what keeps the recorded height honest.
      title: () => current().title,
      icon: providerIcon(provider),
      description: <ProviderUpdateDetail provider={provider} presentation={current()} />,
      label: <ProviderUpdateActionLabel presentation={current()} />,
      // Sonner deletes a toast after its action unless the click is defaultPrevented. Staying is
      // what lets one notification carry the offer, the download and the outcome.
      onClick: (event: MouseEvent) => {
        event.preventDefault();
        act();
      },
    };
  });

  toast(parts.title, {
    id: toastId(provider),
    class: "provider-update-toast",
    icon: parts.icon,
    description: parts.description,
    action: { label: parts.label, onClick: parts.onClick },
    duration: PERSISTENT,
    onDismiss: () => {
      // Only the user reaches this notification while it is still the live one: every close made
      // from this module releases it first, so a late callback for one of those finds nothing.
      if (liveToasts.get(provider) !== parts.live) return;
      const closed = parts.offeredVersion();
      if (closed) closedOffers.set(provider, closed);
      releaseProviderUpdateToast(provider);
    },
  });

  return parts.live;
}

/** Open an offer or an explicitly started update. Reports alone never reopen a closed toast. */
export function showProviderUpdateToast(update: ProviderUpdate, onUpdate: () => void): void {
  const timer = dismissTimers.get(update.provider);
  if (timer !== undefined) window.clearTimeout(timer);
  dismissTimers.delete(update.provider);
  const presentation = presentProviderUpdate(update);
  const live = liveToast(update.provider, presentation);
  live.present(presentation);
  live.setAct(onUpdate);
  live.setOffer(presentation.updatable ? update.availableVersion : null);
}

/** The offer this provider's notification was closed on, and so must not be raised again. */
export function providerUpdateOfferClosed(provider: AgentProviderId, availableVersion: string | null): boolean {
  return availableVersion !== null && closedOffers.get(provider) === availableVersion;
}

/**
 * Take the notification off the screen without ending the offer behind it.
 *
 * A server switch rebuilds the runtime store, and what the user was told about this computer is not
 * the switch's to forget: the offer is raised again on the way back, unless the user closed it.
 */
export function hideProviderUpdateToast(provider: AgentProviderId): void {
  toast.dismiss(toastId(provider));
  releaseProviderUpdateToast(provider);
}

/**
 * Move the same notification through the update: the percentage, then the outcome. A failure offers
 * Retry, because an update a user can start and not reattempt is the dead end this feature exists to
 * remove. A finished update has nothing left to offer, so it counts itself out instead - sonner's
 * own timer never started, and cannot be started now without replacing the notification.
 */
export function reportProviderUpdateToast(update: ProviderUpdate, onRetry: () => void): void {
  const live = liveToasts.get(update.provider);
  if (!live) return;
  const presentation = presentProviderUpdate(update);
  live.present(presentation);
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

/** End the offer as well as the notification: it has been acted on, cancelled or settled. */
export function dismissProviderUpdateToast(provider: AgentProviderId): void {
  closedOffers.delete(provider);
  hideProviderUpdateToast(provider);
}
