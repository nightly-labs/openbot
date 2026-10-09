/**
 * The parts that every integration page shares: the logo on its tile, the status pill, the page
 * header, the danger zone, and the connect dialog with OpenBot and the other app side by side.
 * GitHub, Slack, Discord and Telegram use them.
 */

import { AppLogo } from "@openbot/brand";
import {
  Badge,
  Button,
  Check,
  ConfirmDialog,
  Dialog,
  Heading,
  IconButton,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Text,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";

const GITHUB_MARK_PATH =
  "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";

/** GitHub's mark. Lucide has no brand icons, so the path is GitHub's own. */
export function GitHubMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={GITHUB_MARK_PATH} />
    </svg>
  );
}

const SLACK_MARK_PATH =
  "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z";

/** Slack's mark, for the same reason. */
export function SlackMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={SLACK_MARK_PATH} />
    </svg>
  );
}

const DISCORD_MARK_PATH =
  "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z";

/** Discord's mark, for the same reason. */
export function DiscordMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={DISCORD_MARK_PATH} />
    </svg>
  );
}

/** The paper plane of Telegram's mark, drawn here as one shape. The cut is the fold of the wing. */
const TELEGRAM_MARK_PATH = "M2.5 10.8 21.5 3l-3.7 17.6-5.5-4-2.7 2.6-.6-5.3 9-7.4-10.4 6.4Z";

/** Telegram's mark, for the same reason. */
export function TelegramMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={TELEGRAM_MARK_PATH} />
    </svg>
  );
}

const ONEPASSWORD_MARK_PATH =
  "M12 0c6.627 0 12 5.373 12 12 0 6.628-5.373 12-12 12S0 18.628 0 12C0 5.373 5.373 0 12 0m-.893 4.86c-.485 0-.727.001-.913.095a.87.87 0 0 0-.378.379c-.094.185-.095.428-.095.912v2.747c0 .12 0 .182.016.238q.02.075.065.138a1 1 0 0 0 .175.162l.695.564c.113.092.17.139.19.194a.22.22 0 0 1 0 .15c-.02.056-.077.102-.19.194l-.695.564a1 1 0 0 0-.175.162.4.4 0 0 0-.065.138 1 1 0 0 0-.016.238v6.019c0 .485 0 .728.095.913a.87.87 0 0 0 .378.378c.186.094.428.094.913.094h1.786c.485 0 .727 0 .913-.094a.87.87 0 0 0 .378-.378c.095-.185.095-.428.095-.913v-2.747c0-.12 0-.182-.016-.238a.4.4 0 0 0-.065-.138 1 1 0 0 0-.175-.162l-.695-.564c-.113-.092-.17-.138-.191-.193a.22.22 0 0 1 0-.152c.02-.055.078-.1.19-.193l.696-.564a1 1 0 0 0 .175-.162.4.4 0 0 0 .065-.138 1 1 0 0 0 .016-.238V6.246c0-.484 0-.727-.095-.912a.87.87 0 0 0-.378-.379c-.186-.094-.428-.094-.913-.094Z";

/** 1Password's mark, for the same reason. */
export function OnePasswordMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={ONEPASSWORD_MARK_PATH} />
    </svg>
  );
}

/** A logo on a quiet square. `size` "lg" is the page header. */
export function LogoTile(props: { children: JSX.Element; size?: "md" | "lg" }) {
  return (
    <span class="integration-logo-tile" data-size={props.size ?? "md"}>
      {props.children}
    </span>
  );
}

export type IntegrationStatus = "connected" | "attention" | "idle" | "unavailable";

const STATUS_VARIANT = {
  connected: "success-light",
  attention: "warning-light",
  idle: "secondary",
  unavailable: "outline",
} as const satisfies Record<IntegrationStatus, string>;

export function StatusPill(props: { status: IntegrationStatus; label: string }) {
  return (
    <Badge class="integration-status" variant={STATUS_VARIANT[props.status]} data-status={props.status}>
      <span class="integration-status-dot" aria-hidden="true" />
      {props.label}
    </Badge>
  );
}

/** The top of an integration page: the logo, the name with its status, what it gives, and its action. */
export function DetailHeader(props: {
  logo: JSX.Element;
  name: string;
  status: IntegrationStatus;
  statusLabel: string;
  subtitle: JSX.Element;
  actions?: JSX.Element;
}) {
  return (
    <div class="integration-detail-header">
      <LogoTile size="lg">{props.logo}</LogoTile>
      <div class="integration-detail-copy">
        <div class="integration-detail-title">
          <Heading as="h3" size="md">
            {props.name}
          </Heading>
          <StatusPill status={props.status} label={props.statusLabel} />
        </div>
        <Text variant="caption" tone="muted">
          {props.subtitle}
        </Text>
      </div>
      <Show when={props.actions}>
        <div class="integration-detail-actions">{props.actions}</div>
      </Show>
    </div>
  );
}

export function DangerZone(props: {
  title: string;
  description: string;
  action: string;
  busy?: boolean;
  /** Ask before the action, in a dialog with the same title, description and action. */
  confirm?: boolean;
  onAction: () => void;
}) {
  const { t } = useText();
  const [confirming, setConfirming] = createSignal(false);
  return (
    <SettingsSection title={t("connector.dangerZone")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{props.title}</ItemTitle>
            <ItemDescription>{props.description}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              size="sm"
              variant="destructive-ghost"
              loading={props.busy ?? false}
              onClick={() => (props.confirm ? setConfirming(true) : props.onAction())}
            >
              {props.action}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
      <Show when={props.confirm}>
        <ConfirmDialog
          open={confirming()}
          initialFocus="cancel"
          title={props.title}
          description={props.description}
          confirmLabel={props.action}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            props.onAction();
          }}
        />
      </Show>
    </SettingsSection>
  );
}

/** Numbered steps. Only the numbers show: the dialog title names the step, and readers hear each label. */
export function Stepper(props: { steps: readonly string[]; current: number; label: string }) {
  return (
    <ol class="integration-stepper" aria-label={props.label}>
      <For each={props.steps}>
        {(step, index) => {
          const state = () => (index() < props.current ? "done" : index() === props.current ? "current" : "next");
          return (
            <li class="integration-step" data-state={state()} aria-current={state() === "current" ? "step" : undefined}>
              <span class="integration-step-index" aria-hidden="true">
                <Show when={state() === "done"} fallback={index() + 1}>
                  <Check size={12} />
                </Show>
              </span>
              <span class="sr-only">{step}</span>
            </li>
          );
        }}
      </For>
    </ol>
  );
}

/** The line between OpenBot and the other app: moving while connecting, solid when done, broken on an error. */
export type WizardLink = "connecting" | "connected" | "broken";

export interface WizardProps {
  logo: JSX.Element;
  link?: WizardLink;
  title: string;
  description: JSX.Element;
  stepper?: JSX.Element;
  children?: JSX.Element;
  footer: JSX.Element;
}

/** The body of a connect dialog. `heading` is the title element, so a dialog can give its own. */
export function WizardContent(props: WizardProps & { heading: JSX.Element }) {
  return (
    <>
      <div class="integration-wizard-head">
        <div class="integration-wizard-logos" data-link={props.link ?? "connecting"} aria-hidden="true">
          <AppLogo variant="production" animation="blink" class="integration-wizard-app" />
          <span class="integration-wizard-link" />
          <span class="integration-wizard-target">
            <LogoTile>{props.logo}</LogoTile>
          </span>
        </div>
        {props.stepper}
        {props.heading}
        <Text variant="body-sm" tone="muted">
          {props.description}
        </Text>
      </div>
      <Show when={props.children}>
        <div class="integration-wizard-body">{props.children}</div>
      </Show>
      <div class="integration-wizard-foot">{props.footer}</div>
    </>
  );
}

/**
 * A connect dialog over the settings window. With `dismissible` false, a click outside does not close
 * it: the user may come back from the browser while a flow runs, and that click must not stop the flow.
 */
export function WizardDialog(
  props: WizardProps & { open: boolean; closeLabel: string; dismissible?: boolean; onClose: () => void },
) {
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="integration-dialog-backdrop" />
        <Dialog.Content
          class="integration-wizard integration-wizard-dialog"
          as="section"
          onInteractOutside={(event) => {
            if (props.dismissible === false) event.preventDefault();
          }}
        >
          <WizardContent
            {...props}
            description={<Dialog.Description as="span">{props.description}</Dialog.Description>}
            heading={
              <Dialog.Title as="h2" class="ui-heading" data-size="md" data-tone="primary">
                {props.title}
              </Dialog.Title>
            }
          />
          <IconButton
            class="integration-dialog-close"
            label={props.closeLabel}
            variant="ghost"
            data-cuelume-tap="close"
            onClick={props.onClose}
          >
            <X />
          </IconButton>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
