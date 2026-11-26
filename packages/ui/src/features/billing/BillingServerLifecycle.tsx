import {
  Button,
  buttonVariants,
  CalendarClock,
  Check,
  ConfirmDialog,
  DropdownMenu,
  Ellipsis,
  Field,
  Input,
  Server,
  Text,
  Trash2,
} from "@openbot/ui";
import { createSignal, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import "./billing-server-lifecycle-preview.css";

export type BillingServerLifecycleAction = "cancel" | "keep" | "delete";

export interface BillingServerLifecycleProps {
  name: string;
  planDescription: string;
  price: string;
  running: boolean;
  statusLabel?: string;
  onAddStorage?: (() => void) | undefined;
  onWake?: (() => void) | undefined;
  cancelAtPeriodEnd: boolean;
  paidThrough: number;
  scheduled: boolean;
  action: BillingServerLifecycleAction | null;
  confirmName: string;
  pending: boolean;
  error: string | null;
  onAction: (action: BillingServerLifecycleAction) => void;
  onNameChange: (name: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function BillingServerLifecycle(props: BillingServerLifecycleProps) {
  const { t, format } = useText();
  let menuButton: HTMLButtonElement | undefined;
  const [dialogTrigger, setDialogTrigger] = createSignal<HTMLButtonElement>();
  let deleteRequested = false;
  let menuCloseFrame: number | undefined;
  onSettled(() => () => {
    if (menuCloseFrame !== undefined) cancelAnimationFrame(menuCloseFrame);
  });
  const shortDate = () =>
    format.date(new Date(props.paidThrough), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const date = () =>
    format.date(new Date(props.paidThrough), { dateStyle: "long", timeStyle: "short", timeZone: "UTC" });
  const dateLabel = () => t("billing.lifecycle.dateUtc", { date: date() });
  const confirmLabel = () => {
    if (props.action === "keep") return t("billing.lifecycle.keep");
    if (props.action === "cancel") return t("billing.lifecycle.cancelRenewal");
    return t("billing.lifecycle.schedule");
  };
  const title = () => {
    if (props.action === "keep") return t("billing.lifecycle.keepTitle", { name: props.name });
    if (props.action === "cancel") return t("billing.lifecycle.cancelTitle", { name: props.name });
    return t("billing.lifecycle.deleteTitle", { name: props.name });
  };
  const description = () => {
    if (props.action === "keep")
      return t(props.scheduled ? "billing.lifecycle.keepDescription" : "billing.lifecycle.resumeDescription");
    if (props.action === "cancel") return t("billing.lifecycle.cancelDescription");
    return t("billing.lifecycle.scheduleDescription");
  };

  return (
    <section class="billing-lifecycle-panel" aria-label={props.name}>
      <div class="billing-lifecycle-card">
        <div class="billing-lifecycle-identity">
          <span class="billing-lifecycle-server-icon">
            <Server aria-hidden="true" />
          </span>
          <div class="billing-lifecycle-server-copy">
            <Text as="strong" variant="label">
              {props.name}
            </Text>
            <Text tone="muted" variant="caption">
              {props.planDescription}
            </Text>
          </div>
          <div class="billing-lifecycle-price">
            <Text variant="label">{props.price}</Text>
            <Text variant="caption" tone="muted">
              {props.statusLabel ??
                t(props.running ? "settings.hostedServers.state.running" : "settings.hostedServers.state.stopped")}
            </Text>
          </div>
          <DropdownMenu.Root placement="bottom-end">
            <DropdownMenu.Trigger
              ref={menuButton}
              class={buttonVariants({ variant: "ghost", size: "icon" })}
              aria-label={t("billing.lifecycle.actions", { name: props.name })}
            >
              <Ellipsis aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                class="billing-lifecycle-menu"
                onCloseAutoFocus={(event) => {
                  if (!deleteRequested) return;
                  event.preventDefault();
                  deleteRequested = false;
                  menuCloseFrame = requestAnimationFrame(() => {
                    menuCloseFrame = requestAnimationFrame(() => props.onAction("delete"));
                  });
                }}
              >
                <Show when={props.onAddStorage}>
                  <DropdownMenu.Item onSelect={() => props.onAddStorage?.()}>
                    {t("billing.action.addStorage")}
                  </DropdownMenu.Item>
                </Show>
                <Show when={props.onWake}>
                  <DropdownMenu.Item onSelect={() => props.onWake?.()}>
                    {t("settings.hostedServers.wake")}
                  </DropdownMenu.Item>
                </Show>
                <DropdownMenu.Item
                  class="ui-action-menu-danger"
                  disabled={props.scheduled}
                  onSelect={() => {
                    setDialogTrigger(menuButton);
                    deleteRequested = true;
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  {t("billing.lifecycle.deleteServer")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        <div class="billing-lifecycle-billing" data-scheduled={props.scheduled ? "" : undefined}>
          <Show when={props.scheduled}>
            <CalendarClock class="billing-lifecycle-calendar" aria-hidden="true" />
          </Show>
          <div class="billing-lifecycle-billing-copy" role={props.scheduled ? "status" : undefined}>
            <Text variant="label-sm" tone={props.scheduled ? "warning" : "secondary"}>
              {t(
                props.scheduled
                  ? "billing.lifecycle.deletesOn"
                  : props.cancelAtPeriodEnd
                    ? "billing.server.ends"
                    : "billing.server.renews",
                { date: shortDate() },
              )}
            </Text>
            <Text tone="muted" variant="caption">
              {t(
                props.scheduled
                  ? "billing.lifecycle.scheduledDescription"
                  : props.cancelAtPeriodEnd
                    ? "billing.lifecycle.dataStays"
                    : "billing.lifecycle.renews",
              )}
            </Text>
          </div>
          <Button
            variant={props.scheduled || props.cancelAtPeriodEnd ? "default" : "ghost"}
            size="sm"
            onClick={(event) => {
              setDialogTrigger(event.currentTarget);
              props.onAction(props.scheduled || props.cancelAtPeriodEnd ? "keep" : "cancel");
            }}
          >
            {t(
              props.scheduled || props.cancelAtPeriodEnd ? "billing.lifecycle.keep" : "billing.lifecycle.cancelRenewal",
            )}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={props.action !== null}
        title={title()}
        description={description()}
        media={
          <span class="billing-lifecycle-dialog-icon">
            {props.action === "keep" ? <Check aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
          </span>
        }
        confirmLabel={confirmLabel()}
        cancelLabel={t("common.cancel")}
        pendingLabel={t("billing.lifecycle.saving")}
        pending={props.pending}
        error={props.error ?? undefined}
        initialFocus="cancel"
        restoreFocusTarget={dialogTrigger()}
        onCancel={props.onCancel}
        onConfirm={props.onConfirm}
      >
        <div class="billing-lifecycle-receipt">
          <div>
            <Text variant="caption" tone="muted">
              {t("billing.lifecycle.serverLabel")}
            </Text>
            <Text variant="label-sm">{props.name}</Text>
          </div>
          <div>
            <Text variant="caption" tone="muted">
              {t(
                props.action === "keep"
                  ? "billing.lifecycle.renewalLabel"
                  : props.action === "cancel"
                    ? "billing.lifecycle.planEndsLabel"
                    : "billing.lifecycle.deletionLabel",
              )}
            </Text>
            <Text variant="label-sm">{dateLabel()}</Text>
          </div>
          <div>
            <Text variant="caption" tone="muted">
              {t("billing.lifecycle.billingLabel")}
            </Text>
            <Text variant="label-sm">
              {t(props.action === "keep" ? "billing.lifecycle.automatic" : "billing.lifecycle.noRenewal")}
            </Text>
          </div>
        </div>
        <Show when={props.action === "delete"}>
          <Field label={t("settings.hostedServers.deleteConfirmLabel", { name: props.name })}>
            <Input
              value={props.confirmName}
              autocomplete="off"
              spellcheck={false}
              disabled={props.pending}
              onValueChange={props.onNameChange}
            />
          </Field>
        </Show>
      </ConfirmDialog>
    </section>
  );
}
