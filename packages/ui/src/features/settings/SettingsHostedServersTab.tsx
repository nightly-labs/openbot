import { BILLING_PLANS, type BillingPlanId } from "@openbot/contracts/billing";
import {
  HOSTED_SERVER_SIZES,
  type HostedServerState,
  type HostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  type BadgeTone,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Plus,
  SettingsSection,
  Text,
  Trash2,
} from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import type { SettingsHostedServersStore } from "./stores/hosted-servers-store";

interface SettingsHostedServersTabProps {
  store: SettingsHostedServersStore;
  /** Opens the add server dialog, where the user picks a plan and pays. */
  onAddServer?: (() => void) | undefined;
}

const PLAN_NAMES = {
  starter: "settings.hostedServers.plan.starter.name",
  standard: "settings.hostedServers.plan.standard.name",
  pro: "settings.hostedServers.plan.pro.name",
} as const satisfies Record<BillingPlanId, AppTextKey>;

const STATE_LABELS = {
  awaiting_payment: "settings.hostedServers.state.awaitingPayment",
  creating: "settings.hostedServers.state.creating",
  starting: "settings.hostedServers.state.starting",
  running: "settings.hostedServers.state.running",
  stopping: "settings.hostedServers.state.stopping",
  stopped: "settings.hostedServers.state.stopped",
  waking: "settings.hostedServers.state.waking",
  error: "settings.hostedServers.state.error",
  deleted: "settings.hostedServers.state.deleted",
} as const satisfies Record<HostedServerState, AppTextKey>;

const STATE_TONES: Record<HostedServerState, BadgeTone> = {
  awaiting_payment: "warning",
  creating: "accent",
  starting: "accent",
  running: "success",
  stopping: "neutral",
  stopped: "neutral",
  waking: "accent",
  error: "danger",
  deleted: "neutral",
};

export function SettingsHostedServersTab(props: SettingsHostedServersTabProps) {
  const { t } = useText();
  const state = () => props.store.state;
  const planEnded = (server: HostedServerSummary) => server.state === "stopped" && server.error === "plan_ended";
  const description = (server: HostedServerSummary) => {
    if (server.state === "awaiting_payment") return t("settings.hostedServers.paymentDescription");
    if (planEnded(server)) return t("settings.hostedServers.planEndedDescription");
    if (server.state === "error") return t("settings.hostedServers.errorDescription");
    const size = HOSTED_SERVER_SIZES[server.size];
    return t("settings.hostedServers.planSpec", {
      plan: t(PLAN_NAMES[server.plan]),
      vcpu: size.vcpu,
      memory: size.memoryGb,
      // The plan's storage, as the plan cards show it. The machine disk can be larger.
      disk: BILLING_PLANS.find((plan) => plan.id === server.plan)?.storageGb ?? size.diskGb,
    });
  };

  return (
    <SettingsSection title={t("settings.hostedServers.title")} description={t("settings.hostedServers.description")}>
      <Show when={props.onAddServer}>
        {(addServer) => (
          <div class="hosted-servers-add">
            <Button onClick={() => addServer()()}>
              <Plus size={14} aria-hidden="true" />
              {t("settings.hostedServers.add")}
            </Button>
          </div>
        )}
      </Show>
      <Text tone="muted" variant="caption">
        {t("settings.hostedServers.usageNote")}
      </Text>

      <Show when={state().error}>{(message) => <p class="settings-modal-error">{message()}</p>}</Show>
      <Show
        when={state().servers.length > 0}
        fallback={
          <Show when={state().loaded}>
            <Text tone="muted">{t("settings.hostedServers.empty")}</Text>
          </Show>
        }
      >
        <ItemGroup class="settings-modal-card hosted-servers-list" surface="subtle">
          <For each={state().servers}>
            {(server) => (
              <Item class="hosted-servers-row">
                <ItemContent>
                  <ItemTitle>
                    {server.name}
                    <Show
                      when={planEnded(server)}
                      fallback={<Badge tone={STATE_TONES[server.state]}>{t(STATE_LABELS[server.state])}</Badge>}
                    >
                      <Badge tone="warning">{t("settings.hostedServers.state.planEnded")}</Badge>
                    </Show>
                  </ItemTitle>
                  <ItemDescription>{description(server)}</ItemDescription>
                </ItemContent>
                <ItemActions class="hosted-servers-actions">
                  <Show when={server.state === "awaiting_payment" || planEnded(server)}>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t(
                        planEnded(server) ? "settings.hostedServers.renewLabel" : "settings.hostedServers.payLabel",
                        { name: server.name },
                      )}
                      disabled={state().checkoutServerId !== null}
                      onClick={() => void props.store.openCheckout(server)}
                    >
                      {state().checkoutServerId === server.serverId
                        ? t("settings.hostedServers.openingCheckout")
                        : t(planEnded(server) ? "settings.hostedServers.renew" : "settings.hostedServers.pay")}
                    </Button>
                  </Show>
                  <Show when={(server.state === "stopped" && !planEnded(server)) || server.state === "error"}>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("settings.hostedServers.wakeLabel", { name: server.name })}
                      disabled={state().wakingServerId !== null}
                      onClick={() => void props.store.wake(server)}
                    >
                      {state().wakingServerId === server.serverId
                        ? t("settings.hostedServers.waking")
                        : t("settings.hostedServers.wake")}
                    </Button>
                  </Show>
                  <Button
                    variant="destructive-ghost"
                    size="sm"
                    aria-label={t("settings.hostedServers.deleteLabel", { name: server.name })}
                    disabled={state().deleting}
                    onClick={() => props.store.requestDelete(server)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {t("common.delete")}
                  </Button>
                </ItemActions>
              </Item>
            )}
          </For>
        </ItemGroup>
      </Show>

      <ConfirmDialog
        open={state().pendingDelete !== null}
        title={t("settings.hostedServers.deleteTitle", { name: state().pendingDelete?.name ?? "" })}
        description={t("settings.hostedServers.deleteDescription")}
        confirmLabel={t("common.delete")}
        pendingLabel={t("settings.hostedServers.deleting")}
        pending={state().deleting}
        error={state().deleteError ?? undefined}
        initialFocus="cancel"
        onCancel={props.store.cancelDelete}
        onConfirm={props.store.confirmDelete}
      >
        <Field label={t("settings.hostedServers.deleteConfirmLabel", { name: state().pendingDelete?.name ?? "" })}>
          <Input
            value={state().deleteConfirmName}
            autocomplete="off"
            spellcheck={false}
            disabled={state().deleting}
            onValueChange={props.store.setDeleteConfirmName}
          />
        </Field>
      </ConfirmDialog>
    </SettingsSection>
  );
}
