/**
 * The parts that every integration page shares: the page shell, the logo on its tile, the status pill,
 * the page header, the danger zone, and the connect dialog with OpenBot and the other app side by side.
 * The connectors and the Marketplace app pages use them.
 */

import { AppLogo } from "@openbot/brand";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
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
  OctagonX,
  SettingsSection,
  Text,
  TriangleAlert,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";

/** An agent as an integration page shows it: its face and its name. */
export type IntegrationAgent = Pick<AgentProfile, "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;

/** A logo on a quiet square. `size` "lg" is the page header. */
export function LogoTile(props: { children: JSX.Element; size?: "md" | "lg" }) {
  return (
    <span class="integration-logo-tile" data-size={props.size ?? "md"}>
      {props.children}
    </span>
  );
}

/** `connecting` is a sign-in that waits for the user, in a browser or another app. */
export type IntegrationStatus = "connected" | "attention" | "connecting" | "idle" | "unavailable";

const STATUS_VARIANT = {
  connected: "success-light",
  attention: "warning-light",
  connecting: "secondary",
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

/**
 * The status of a connection that OpenBot could not read. It is not "Not set up": the connection can
 * be there. The page says why the read failed and has Retry.
 */
export const UNKNOWN_STATUS = {
  status: "attention",
  label: "connector.statusUnknown",
} as const satisfies { status: IntegrationStatus; label: AppTextKey };

/** A read of a connection that failed: why, and Retry. `message` is the reason in the reader's language. */
export function ReadFailedAlert(props: { message: string; onRetry?: (() => void) | undefined }) {
  const { t } = useText();
  const title = () => t("connector.readFailed");
  return (
    <Alert tone="warning" role="alert">
      <AlertIcon>
        <TriangleAlert />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>{title()}</AlertTitle>
        <Show when={props.message !== title()}>
          <AlertDescription>{props.message}</AlertDescription>
        </Show>
      </AlertContent>
      <Show when={props.onRetry}>
        {(retry) => (
          <AlertActions>
            <Button type="button" size="sm" variant="outline" onClick={() => retry()()}>
              {t("common.retry")}
            </Button>
          </AlertActions>
        )}
      </Show>
    </Alert>
  );
}

/** An action that failed: what failed, and why. `message` is a source text from the main process. */
export function ActionFailedAlert(props: { title: string; message: string }) {
  const { sourceText } = useText();
  return (
    <Alert tone="danger" role="alert">
      <AlertIcon>
        <OctagonX />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>{props.title}</AlertTitle>
        <AlertDescription>{sourceText(props.message)}</AlertDescription>
      </AlertContent>
    </Alert>
  );
}

export interface DetailHeaderProps {
  logo: JSX.Element;
  name: string;
  status: IntegrationStatus;
  statusLabel: string;
  subtitle: JSX.Element;
  /** The next step of the connection, as small buttons. The connect flow that it opens stays in the page. */
  actions?: JSX.Element;
}

/** What the page that shows an integration adds to it. The Marketplace adds its try card and description, and the information. */
export interface IntegrationPageSlots {
  /**
   * The one line under the name, in place of the page's own description. The Marketplace gives the listing's
   * tagline here, and shows the description in its information.
   */
  tagline?: string | undefined;
  /** After the alerts, before the integration's own content. */
  intro?: JSX.Element;
  /** After the integration's own content, before the danger zone. */
  details?: JSX.Element;
}

/**
 * The shell of an integration page. Each integration gives its header, its alerts and its own content: the connect
 * steps, the accounts, the chats. The shell puts them in one order on every page: the header, why the state could
 * not be read, the action that failed, the host's intro, the content, the host's details, and the danger zone.
 *
 * Every page follows these rules, so that all app pages look the same:
 * 1. The header has the name, the status pill, what the app gives, and one small page action (Connect, Reconnect).
 * 2. The alerts come next: the read error, the failed action, then the integration's warning with its fix.
 * 3. `intro` is only for special content, such as the plugin's try card.
 * 4. Each other block is a `SettingsSection`: a heading, an optional description, an optional small outline action.
 *    Its body is one filled card. No text, link or form sits on the page background.
 * 5. In a card, rows are `Item.settings-modal-row`. Other content (a form, a list, information) is in one
 *    `.integration-card-body`. A note is the last line of the card, in `.integration-card-note`, not under the card.
 * 6. A row action is a small outline button. A row that removes one item uses a small `destructive-ghost` button.
 * 7. The danger zone is last, when the app can be disconnected.
 */
export function IntegrationPage(
  props: DetailHeaderProps &
    IntegrationPageSlots & {
      /** The integration's own class, for the rules of its content. */
      class: string;
      /** Why the state could not be read. The content then offers no action that depends on the state. */
      readError?: string | null | undefined;
      onRetry?: (() => void) | undefined;
      /** The last action that failed. */
      failure?: { title: string; message: string } | null | undefined;
      /** An alert of the integration, such as an expired sign-in, after the failure. */
      alert?: JSX.Element;
      /** The DangerZone, when the integration has something to remove. */
      danger?: JSX.Element;
      children?: JSX.Element;
    },
) {
  return (
    <div class={`integration-page ${props.class}`}>
      {/* Each prop stays a getter: the header reads it when it renders, not when the page is set up. */}
      <DetailHeader
        logo={props.logo}
        name={props.name}
        status={props.status}
        statusLabel={props.statusLabel}
        subtitle={props.tagline ?? props.subtitle}
        actions={props.actions}
      />
      <Show when={props.readError}>{(message) => <ReadFailedAlert message={message()} onRetry={props.onRetry} />}</Show>
      <Show when={props.failure}>{(failure) => <ActionFailedAlert {...failure()} />}</Show>
      {props.alert}
      {props.intro}
      {props.children}
      {props.details}
      {props.danger}
    </div>
  );
}

/** The top of an integration page: the logo, the name with its status, what it gives, and its action. */
export function DetailHeader(props: DetailHeaderProps) {
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
  /** Makes the body and the footer one form, so Enter in a field submits it. */
  onSubmit?: () => void;
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
      <Show when={props.onSubmit} fallback={<WizardParts footer={props.footer}>{props.children}</WizardParts>}>
        <form
          class="integration-wizard-form"
          // A missing value is reported under its field. The browser bubble would block the submit.
          novalidate
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit?.();
          }}
        >
          <WizardParts footer={props.footer}>{props.children}</WizardParts>
        </form>
      </Show>
    </>
  );
}

/** The content and the buttons, in a form or not. */
function WizardParts(props: { footer: JSX.Element; children?: JSX.Element }) {
  return (
    <>
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
 * `nested` puts it over the Marketplace and its menus. `wide` makes room for a page drawn in the dialog.
 */
export function WizardDialog(
  props: WizardProps & {
    open: boolean;
    closeLabel: string;
    dismissible?: boolean;
    closeDisabled?: boolean | undefined;
    nested?: boolean | undefined;
    wide?: boolean | undefined;
    onClose: () => void;
  },
) {
  let content: HTMLElement | undefined;
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="integration-dialog-backdrop" data-nested={props.nested ? "" : undefined} />
        <Dialog.Content
          class="integration-wizard integration-wizard-dialog"
          data-nested={props.nested ? "" : undefined}
          data-wide={props.wide ? "" : undefined}
          as="section"
          ref={(element) => {
            content = element;
          }}
          onOpenAutoFocus={(event) => {
            // A form opens on what it asks for: its first field, or its submit when it asks for nothing.
            // The first button in the order is Cancel, and Enter must not cancel.
            const form = content?.querySelector("form.integration-wizard-form");
            const target = form?.querySelector<HTMLElement>(
              "input:not(:disabled), textarea:not(:disabled), button[type=submit]:not(:disabled)",
            );
            if (!target) return;
            event.preventDefault();
            target.focus({ preventScroll: true });
          }}
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
            disabled={props.closeDisabled}
            onClick={props.onClose}
          >
            <X />
          </IconButton>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
