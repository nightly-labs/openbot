import type { BillingPlanId, BillingServerPlan } from "@openbot/contracts/billing";
import type { HostedServerSummary } from "@openbot/contracts/hosted-servers";
import { Button, CreditCard, Settings, SettingsSection, Text, UserRound } from "@openbot/ui";
import { BillingDialog } from "@openbot/ui/features/billing/BillingDialog";
import {
  BillingServerLifecycle,
  type BillingServerLifecycleAction,
} from "@openbot/ui/features/billing/BillingServerLifecycle";
import { createBillingStore } from "@openbot/ui/features/billing/billing-store";
import { SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import { createSettingsHostedServersStore } from "@openbot/ui/features/settings/stores/hosted-servers-store";
import { useText } from "@openbot/ui/text";
import { createStore, For, untrack } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createMockHostedServers } from "../src/preview/mock-hosted-servers";
import "./billing-server-lifecycle-story.css";

interface PreviewServer {
  id: string;
  name: string;
  plan: BillingPlanId;
  amount: number;
  storage: number;
  paidThrough: number;
  running: boolean;
  cancelAtPeriodEnd: boolean;
  scheduled: boolean;
  deleted: boolean;
}

interface LifecycleStoryProps {
  single?: boolean;
  scheduled?: boolean;
  cancelled?: boolean;
  action?: BillingServerLifecycleAction;
  timing?: "period-end" | "now";
  pending?: boolean;
  error?: boolean;
  failNext?: boolean;
  narrow?: boolean;
}

const PLAN_LABELS = {
  starter: "billing.plan.starter",
  standard: "billing.plan.standard",
  pro: "billing.plan.pro",
} as const;

function previewServers(): PreviewServer[] {
  return [
    {
      id: "research",
      name: "Research",
      plan: "starter",
      amount: 20,
      storage: 12,
      paidThrough: Date.UTC(2026, 10, 8, 12),
      running: true,
      cancelAtPeriodEnd: false,
      scheduled: false,
      deleted: false,
    },
    {
      id: "team",
      name: "Team",
      plan: "standard",
      amount: 50,
      storage: 50,
      paidThrough: Date.UTC(2026, 10, 12, 12),
      running: true,
      cancelAtPeriodEnd: true,
      scheduled: true,
      deleted: false,
    },
    {
      id: "archive",
      name: "Archive",
      plan: "pro",
      amount: 100,
      storage: 100,
      paidThrough: Date.UTC(2026, 10, 20, 12),
      running: false,
      cancelAtPeriodEnd: true,
      scheduled: false,
      deleted: false,
    },
  ];
}

function LifecycleStory(props: LifecycleStoryProps) {
  const { t, format } = useText();
  const initial = () => {
    const servers = previewServers();
    const first = servers[0];
    if (first) {
      first.scheduled = props.scheduled ?? false;
      first.cancelAtPeriodEnd = (props.cancelled || props.scheduled) ?? false;
    }
    return {
      open: true,
      servers: props.single ? servers.slice(0, 1) : servers,
      activeServerId: "research",
      action: props.action ?? null,
      timing: props.timing ?? "period-end",
      confirmName: props.pending || props.error ? "Research" : "",
      error: props.error ? t("billing.lifecycle.failed") : null,
      failNext: props.failNext ?? false,
    };
  };
  const [state, setState] = createStore(untrack(initial));

  function confirm() {
    if (props.pending) return;
    const server = state.servers.find((entry) => entry.id === state.activeServerId);
    if (!server) return;
    if (state.action === "delete" && state.confirmName !== server.name) {
      setState((draft) => {
        draft.error = t("settings.hostedServers.deleteNameMismatch");
      });
      return;
    }
    if (state.failNext) {
      setState((draft) => {
        draft.failNext = false;
        draft.error = t("billing.lifecycle.failed");
      });
      return;
    }
    setState((draft) => {
      const target = draft.servers.find((entry) => entry.id === draft.activeServerId);
      if (!target) return;
      if (draft.action === "delete") {
        target.cancelAtPeriodEnd = true;
        if (draft.timing === "now") target.deleted = true;
        else target.scheduled = true;
      } else if (draft.action === "cancel") {
        target.cancelAtPeriodEnd = true;
      } else if (draft.action === "keep") {
        target.cancelAtPeriodEnd = false;
        target.scheduled = false;
      }
      draft.action = null;
      draft.error = null;
      draft.confirmName = "";
    });
  }

  return (
    <div class="billing-lifecycle-story">
      <Button
        variant="outline"
        onClick={() =>
          setState((draft) => {
            draft.open = true;
          })
        }
      >
        {t("billing.lifecycle.open")}
      </Button>
      <SettingsDialogShell
        class={
          props.narrow
            ? "app-settings-modal-shell billing-lifecycle-story-shell billing-lifecycle-story-narrow"
            : "app-settings-modal-shell billing-lifecycle-story-shell"
        }
        open={state.open}
        onOpenChange={(open) => {
          if (!state.action)
            setState((draft) => {
              draft.open = open;
            });
        }}
        title={t("settings.tab.billing.title")}
        description={t("settings.tab.billing.description")}
        contentKey="billing"
        sidebar={
          <div class="settings-modal-nav">
            <div class="settings-modal-nav-item" aria-hidden="true">
              <Settings />
              {t("settings.tab.general.title")}
            </div>
            <div class="settings-modal-nav-item" aria-hidden="true">
              <UserRound />
              {t("settings.tab.profile.title")}
            </div>
            <div class="settings-modal-nav-item" aria-current="page">
              <CreditCard />
              {t("settings.tab.billing.title")}
            </div>
          </div>
        }
        footer={
          <div class="billing-lifecycle-story-footer">
            <Text variant="caption" tone="muted">
              {t("billing.lifecycle.label")}
            </Text>
            <Button variant="ghost" size="sm" onClick={() => setState(() => initial())}>
              {t("billing.lifecycle.reset")}
            </Button>
          </div>
        }
      >
        <SettingsSection title={t("billing.servers.title")} description={t("billing.lifecycle.plansDescription")}>
          <div class="billing-lifecycle-list">
            <For each={state.servers}>
              {(server) => (
                <BillingServerLifecycle
                  name={server.name}
                  planDescription={t("billing.server.summary", {
                    plan: t(PLAN_LABELS[server.plan]),
                    size: format.number(server.storage),
                  })}
                  price={t("billing.server.price.month", {
                    amount: format.number(server.amount, {
                      style: "currency",
                      currency: "EUR",
                      maximumFractionDigits: 0,
                    }),
                  })}
                  paidThrough={server.paidThrough}
                  running={server.running}
                  scheduled={server.scheduled}
                  cancelAtPeriodEnd={server.cancelAtPeriodEnd}
                  deleted={server.deleted}
                  action={state.activeServerId === server.id ? state.action : null}
                  deletionTiming={state.timing}
                  confirmName={state.confirmName}
                  pending={props.pending ?? false}
                  error={state.activeServerId === server.id ? state.error : null}
                  onAction={(action) =>
                    setState((draft) => {
                      draft.activeServerId = server.id;
                      draft.action = action;
                      draft.timing = "period-end";
                      draft.confirmName = "";
                      draft.error = null;
                    })
                  }
                  onTimingChange={(timing) =>
                    setState((draft) => {
                      draft.timing = timing;
                      draft.error = null;
                    })
                  }
                  onNameChange={(name) =>
                    setState((draft) => {
                      draft.confirmName = name;
                      draft.error = null;
                    })
                  }
                  onCancel={() => {
                    if (!props.pending)
                      setState((draft) => {
                        draft.action = null;
                      });
                  }}
                  onConfirm={confirm}
                />
              )}
            </For>
          </div>
        </SettingsSection>
      </SettingsDialogShell>
    </div>
  );
}

const meta = {
  title: "Account/Billing/Server management",
  component: LifecycleStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LifecycleStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MultipleServers: Story = {};
export const OneServer: Story = { args: { single: true } };
export const CancelRenewal: Story = { args: { action: "cancel" } };
export const RenewalCancelled: Story = { args: { single: true, cancelled: true } };
export const ScheduledDeletion: Story = { args: { single: true, scheduled: true } };
export const KeepServer: Story = { args: { scheduled: true, action: "keep" } };
export const DeleteServer: Story = { args: { action: "delete" } };
export const DeleteNow: Story = { args: { action: "delete", timing: "now" } };
export const Pending: Story = { args: { action: "cancel", pending: true } };
export const RequestError: Story = { args: { action: "cancel", error: true } };
export const FailedAction: Story = { args: { failNext: true } };
export const Narrow: Story = { args: { narrow: true } };

/** The app's real controller and panel, with in-memory account API responses. */
function ApplicationBillingStory(props: { failNext?: boolean }) {
  const { t } = useText();
  let failNext = untrack(() => props.failNext) ?? false;
  const [state, setState] = createStore({ open: true });
  let hosts: HostedServerSummary[] = previewServers().map((server) => ({
    serverId: server.id,
    name: server.name,
    size: "small",
    plan: server.plan,
    interval: "month",
    currency: "eur",
    state: server.running ? "running" : "stopped",
    error: null,
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
    deletionScheduledAt: server.scheduled ? server.paidThrough : null,
  }));
  let plans: BillingServerPlan[] = previewServers().map((server) => ({
    subscriptionId: server.id,
    serverId: server.id,
    serverName: server.name,
    plan: server.plan,
    interval: "month",
    currency: "eur",
    amount: server.amount * 100,
    status: "active",
    currentPeriodEnd: server.paidThrough,
    cancelAtPeriodEnd: server.cancelAtPeriodEnd,
  }));
  const hosting = createSettingsHostedServersStore(
    {
      get open() {
        return state.open;
      },
      hostedServersApi: {
        ...createMockHostedServers(),
        list: async () => structuredClone({ available: true, lifecycleAvailable: true, servers: hosts, maxServers: 3 }),
        lifecycle: async (input) => {
          if (failNext) {
            failNext = false;
            throw new Error(t("billing.lifecycle.failed"));
          }
          const host = hosts.find((server) => server.serverId === input.serverId);
          if (!host || (input.action === "delete" && input.confirmName !== host.name))
            throw new Error("Invalid server");
          if (input.action === "delete" && input.timing === "now") {
            hosts = hosts.filter((server) => server.serverId !== input.serverId);
            plans = plans.filter((server) => server.serverId !== input.serverId);
            return;
          }
          plans = plans.map((server) =>
            server.serverId === input.serverId ? { ...server, cancelAtPeriodEnd: input.action !== "keep" } : server,
          );
          hosts = hosts.map((server) =>
            server.serverId === input.serverId
              ? {
                  ...server,
                  deletionScheduledAt:
                    input.action === "delete"
                      ? (plans.find((plan) => plan.serverId === input.serverId)?.currentPeriodEnd ?? null)
                      : null,
                }
              : server,
          );
        },
      },
    },
    () => state.open,
  );
  const billing = createBillingStore(
    () => ({
      getState: async () => structuredClone({ available: true, hasCustomer: true, servers: plans }),
      openPortal: async () => undefined,
    }),
    () => state.open,
  );
  return (
    <BillingDialog
      open={state.open}
      onOpenChange={(open) =>
        setState((draft) => {
          draft.open = open;
        })
      }
      store={billing}
      hostedServers={hosting}
    />
  );
}
export const ApplicationBilling: Story = { render: () => <ApplicationBillingStory /> };

export const ApplicationFailedAction: Story = { render: () => <ApplicationBillingStory failNext /> };
