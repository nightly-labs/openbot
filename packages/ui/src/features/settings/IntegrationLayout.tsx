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

export type IntegrationAgent = Pick<AgentProfile, "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;

export function LogoTile(props: { children: JSX.Element; size?: "md" | "lg" }) {
  return (
    <span class="integration-logo-tile" data-size={props.size ?? "md"}>
      {props.children}
    </span>
  );
}

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

export const UNKNOWN_STATUS = {
  status: "attention",
  label: "connector.statusUnknown",
} as const satisfies { status: IntegrationStatus; label: AppTextKey };

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
  nameMark?: JSX.Element;
  status: IntegrationStatus;
  statusLabel: string;
  subtitle: JSX.Element;
  actions?: JSX.Element;
}

export interface IntegrationPageSlots {
  tagline?: string | undefined;
  intro?: JSX.Element;
  details?: JSX.Element;
}

export function IntegrationPage(
  props: DetailHeaderProps &
    IntegrationPageSlots & {
      class: string;
      readError?: string | null | undefined;
      onRetry?: (() => void) | undefined;
      failure?: { title: string; message: string } | null | undefined;
      alert?: JSX.Element;
      danger?: JSX.Element;
      children?: JSX.Element;
    },
) {
  return (
    <div class={`integration-page ${props.class}`}>
      <DetailHeader
        logo={props.logo}
        name={props.name}
        nameMark={props.nameMark}
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

export function DetailHeader(props: DetailHeaderProps) {
  return (
    <div class="integration-detail-header">
      <LogoTile size="lg">{props.logo}</LogoTile>
      <div class="integration-detail-copy">
        <div class="integration-detail-title">
          <Heading as="h3" size="md" class="integration-detail-name">
            {props.name}
            {props.nameMark}
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

export type WizardLink = "connecting" | "connected" | "broken";

export interface WizardProps {
  logo: JSX.Element;
  link?: WizardLink;
  title: string;
  description: JSX.Element;
  stepper?: JSX.Element;
  children?: JSX.Element;
  footer: JSX.Element;
  onSubmit?: () => void;
}

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
