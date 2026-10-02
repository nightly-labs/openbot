import { AppLogo } from "@openbot/brand";
import { Portal } from "@solidjs/web";
import { createSignal, createUniqueId, For, Match, onSettled, Show, Switch } from "solid-js";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS, PRODUCT_HUNT_LAUNCH_LIVE } from "../../lib/landing-links";
import { Button } from "../ui/button";

/** Long enough for the hero lines to land first, so the dialog is not the first thing that moves. */
const LAUNCH_DIALOG_DELAY_MS = 900;

/**
 * Once per document, not once per page: every page has its own header, so a client navigation
 * mounts a new one, and a visitor who has already answered should not be asked again until a
 * full load. There is no storage, so a reload asks again, which is what the launch wants.
 */
let shownThisLoad = false;

/** The designs the launch dialog can take. Storybook shows each one side by side. */
export type ProductHuntLaunchVariant = "launch-pad" | "ticket" | "team-chat" | "big-arrow" | "terminal";

/** The design the site shows. */
const LIVE_VARIANT: ProductHuntLaunchVariant = "launch-pad";

interface LaunchCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly copy: string;
}

const LAUNCH_COPY: Record<ProductHuntLaunchVariant, LaunchCopy> = {
  "launch-pad": {
    eyebrow: "Live today",
    title: "We're live on Product Hunt",
    copy: "OpenBot is a small, independent project. One upvote takes five seconds and helps more people find persistent AI teammates that run on their own computer.",
  },
  ticket: {
    eyebrow: "Launch day",
    title: "You're on the list",
    copy: "OpenBot is live on Product Hunt today. Your upvote is the ticket that puts it in front of more people.",
  },
  "team-chat": {
    eyebrow: "Message from the team",
    title: "Your agents have one request",
    copy: "We're live on Product Hunt today. An upvote takes five seconds.",
  },
  "big-arrow": {
    eyebrow: "Live on Product Hunt",
    title: "One click. Big help.",
    copy: "OpenBot launched on Product Hunt today. An upvote puts it in front of more people who want AI teammates on their own computer.",
  },
  terminal: {
    eyebrow: "Shipped",
    title: "Now it's your turn",
    copy: "OpenBot is live on Product Hunt. One upvote helps more developers find it.",
  },
};

const CONFETTI = Array.from({ length: 10 }, (_, index) => index);

const TEAM_CHAT = [
  { name: "Chief", text: "We're live on Product Hunt today." },
  { name: "Builder", text: "Could you upvote us? It takes five seconds." },
  { name: "Reviewer", text: "Verified: free, safe, and it helps a lot." },
] as const;

function UpvoteArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4 21 18H3Z" />
    </svg>
  );
}

/** The hero line that points at the launch page. Only the landing page shows it. */
export function ProductHuntPill() {
  return (
    <Show when={PRODUCT_HUNT_LAUNCH_LIVE}>
      <a class="ph-pill" href={OPENBOT_LINKS.productHunt} target="_blank" rel={EXTERNAL_LINK_REL}>
        <span class="ph-pill-mark">
          <UpvoteArrow />
        </span>
        <span class="ph-pill-copy">
          We're live on <strong>Product Hunt</strong>
        </span>
        <span class="ph-pill-cta">Upvote</span>
      </a>
    </Show>
  );
}

function LaunchArt(props: { variant: ProductHuntLaunchVariant }) {
  return (
    <div class="ph-dialog-art" aria-hidden="true">
      <Switch>
        <Match when={props.variant === "launch-pad"}>
          <span class="ph-dialog-confetti">
            <For each={CONFETTI}>{() => <span />}</For>
          </span>
          <AppLogo variant="production" animation="blink" class="ph-dialog-logo" />
          <span class="ph-dialog-times">×</span>
          <span class="ph-dialog-upvote">
            <UpvoteArrow />
            Upvote
          </span>
        </Match>

        <Match when={props.variant === "ticket"}>
          <span class="ph-ticket">
            <span class="ph-ticket-main">
              <span class="ph-ticket-kicker">Product Hunt · Launch day</span>
              <span class="ph-ticket-name">
                <AppLogo variant="production" class="ph-ticket-logo" />
                OpenBot
              </span>
              <span class="ph-ticket-fine">Admit one upvote</span>
            </span>
            <span class="ph-ticket-stub">
              <UpvoteArrow />
              <span>No. 001</span>
            </span>
          </span>
        </Match>

        <Match when={props.variant === "team-chat"}>
          <span class="ph-chat">
            <For each={TEAM_CHAT}>
              {(message) => (
                <span class="ph-chat-row">
                  <span class="ph-chat-avatar" data-agent={message.name}>
                    {message.name.slice(0, 1)}
                  </span>
                  <span class="ph-chat-bubble">
                    <span class="ph-chat-name">{message.name}</span>
                    {message.text}
                  </span>
                </span>
              )}
            </For>
            <span class="ph-chat-row">
              <AppLogo variant="production" animation="blink" class="ph-chat-avatar ph-chat-avatar-logo" />
              <span class="ph-chat-typing">
                <span />
                <span />
                <span />
              </span>
            </span>
          </span>
        </Match>

        <Match when={props.variant === "big-arrow"}>
          <span class="ph-big-arrow">
            <span class="ph-big-arrow-rays" />
            <span class="ph-big-arrow-button">
              <UpvoteArrow />
            </span>
          </span>
        </Match>

        <Match when={props.variant === "terminal"}>
          <span class="ph-terminal">
            <span class="ph-terminal-bar">
              <span />
              <span />
              <span />
            </span>
            <span class="ph-terminal-line">
              <span class="ph-terminal-prompt">$</span> openbot launch --on producthunt
            </span>
            <span class="ph-terminal-line ph-terminal-ok">✓ built ✓ signed ✓ shipped</span>
            <span class="ph-terminal-line ph-terminal-wait">
              → waiting for your upvote
              <span class="ph-terminal-cursor" />
            </span>
          </span>
        </Match>
      </Switch>
    </div>
  );
}

export interface ProductHuntLaunchPanelProps {
  variant: ProductHuntLaunchVariant;
  titleId: string;
  onDismiss: () => void;
}

/** What the dialog holds. Separate from the dialog so Storybook can show every variant at once. */
export function ProductHuntLaunchPanel(props: ProductHuntLaunchPanelProps) {
  const copy = () => LAUNCH_COPY[props.variant];
  return (
    // The panel's padding is here, so a press on the dialog element itself is always the backdrop.
    <div class="ph-dialog-body" data-variant={props.variant}>
      <LaunchArt variant={props.variant} />

      <p class="ph-dialog-eyebrow">
        <span class="ph-dialog-live" aria-hidden="true" />
        {copy().eyebrow}
      </p>
      <h2 class="ph-dialog-title" id={props.titleId}>
        {copy().title}
      </h2>
      <p class="ph-dialog-copy">{copy().copy}</p>

      <div class="ph-dialog-actions">
        <button class="ph-dialog-dismiss" type="button" onClick={() => props.onDismiss()}>
          Maybe later
        </button>
        {/* The focus starts here, on the one thing the dialog asks for. */}
        <Button
          autofocus
          href={OPENBOT_LINKS.productHunt}
          target="_blank"
          rel={EXTERNAL_LINK_REL}
          variant="primary"
          size="md"
          icon="arrow-right"
          class="ph-dialog-upvote-button"
          onClick={() => props.onDismiss()}
        >
          Upvote OpenBot
        </Button>
      </div>
    </div>
  );
}

/**
 * The launch ask, as a modal `<dialog>` on every site page while the launch runs. It follows the
 * plugin pages' download offer (`PluginOpenButtons`): the platform element holds the focus, closes
 * on Escape and gives the focus back, and the portal keeps it out of the header's animated
 * transform, which a modal would otherwise centre itself in.
 */
export function ProductHuntLaunchDialog() {
  const [open, setOpen] = createSignal(false);
  const titleId = createUniqueId();
  let dialog: HTMLDialogElement | undefined;

  onSettled(() => {
    if (!PRODUCT_HUNT_LAUNCH_LIVE || shownThisLoad) return;
    const timer = setTimeout(() => {
      shownThisLoad = true;
      setOpen(true);
    }, LAUNCH_DIALOG_DELAY_MS);
    return () => clearTimeout(timer);
  });

  // Shown as modal in a microtask: a `ref` runs before the element is in the document. A press on
  // the backdrop lands on the element itself, because the backdrop is the dialog's own box.
  const openDialog = (element: HTMLDialogElement) => {
    dialog = element;
    element.addEventListener("click", (event) => {
      if (event.target === element) element.close();
    });
    queueMicrotask(() => {
      if (!element.open) element.showModal();
    });
  };

  return (
    <Show when={open()}>
      <Portal>
        <dialog ref={openDialog} class="ph-dialog" aria-labelledby={titleId} onClose={() => setOpen(false)}>
          <ProductHuntLaunchPanel variant={LIVE_VARIANT} titleId={titleId} onDismiss={() => dialog?.close()} />
        </dialog>
      </Portal>
    </Show>
  );
}
