import type { HostedServerSummary } from "@openbot/contracts/hosted-servers";
import type { AvatarHue, ServerSummary } from "@openbot/contracts/ipc";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  buttonVariants,
  ConfirmDialog,
  type DropdownMenu,
  TriangleAlert,
} from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

const DAY_MS = 24 * 60 * 60_000;

const SAD_AGENTS: readonly { seed: string; hue: AvatarHue }[] = [
  { seed: "chief", hue: 245 },
  { seed: "research", hue: 185 },
  { seed: "sales-outbound", hue: 280 },
];

export interface ServerPlanEnd {
  server: ServerSummary;
  deleteAt: number;
}

export function serverPlanDaysLeft(deleteAt: number, now = Date.now()): number {
  return Math.max(1, Math.ceil((deleteAt - now) / DAY_MS));
}

export function serverPlanDeletionDates(servers: readonly HostedServerSummary[]): ReadonlyMap<string, number> {
  return new Map(
    servers.flatMap((server) =>
      server.error === "plan_ended" && server.dataKeptUntil ? [[server.serverId, server.dataKeptUntil] as const] : [],
    ),
  );
}

export function serverPlanEnds(
  servers: readonly ServerSummary[],
  planDeletesAt: ((serverId: string) => number | null) | undefined,
): ServerPlanEnd[] {
  if (!planDeletesAt) return [];
  return servers
    .flatMap((server) => {
      const deleteAt = planDeletesAt(server.id);
      return deleteAt === null ? [] : [{ server, deleteAt }];
    })
    .sort((left, right) => left.deleteAt - right.deleteAt);
}

export function ServerPlanCount(props: { count: number; class: string }) {
  return (
    <span class={["server-plan-count", props.class]} aria-hidden="true">
      {props.count}
    </span>
  );
}

export function ServerPlanChip(props: { server: ServerSummary; deleteAt: number | null }) {
  const { t } = useText();
  return (
    <Show when={props.deleteAt !== null || props.server.hostedIssue === "plan_ended"}>
      <Badge variant="destructive-light" class="server-plan-chip" aria-hidden="true">
        {props.deleteAt === null
          ? t("server.plan.ended")
          : t("server.plan.daysLeft", { count: serverPlanDaysLeft(props.deleteAt) })}
      </Badge>
    </Show>
  );
}

export function serverPlanStatusLabels(
  server: ServerSummary,
  deleteAt: number | null,
  t: AppTranslate,
  format: AppFormat,
): string[] {
  if (deleteAt !== null) return [t("server.plan.status", { date: format.date(deleteAt, { dateStyle: "long" }) })];
  return server.hostedIssue === "plan_ended" ? [t("server.plan.ended")] : [];
}

export function ServerPlanBanner(props: {
  menu: Pick<typeof DropdownMenu, "Item">;
  end: ServerPlanEnd;
  onRenew: (serverId: string) => Promise<void>;
}) {
  const { t, format } = useText();
  const [pending, setPending] = createSignal(false);
  async function renew(): Promise<void> {
    setPending(true);
    try {
      await props.onRenew(props.end.server.id);
    } finally {
      setPending(false);
    }
  }
  return (
    <Alert tone="danger" report={false} class="server-plan-banner">
      <AlertIcon>
        <TriangleAlert class="size-4" />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>{props.end.server.name}</AlertTitle>
        <AlertDescription>
          {t("server.plan.deletedOn", {
            date: format.date(props.end.deleteAt, { day: "numeric", month: "short" }),
          })}
        </AlertDescription>
      </AlertContent>
      <AlertActions>
        <props.menu.Item
          class={buttonVariants({ size: "sm", class: "server-plan-banner-renew" })}
          closeOnSelect={false}
          disabled={pending()}
          aria-label={t("settings.hostedServers.renewLabel", { name: props.end.server.name })}
          onSelect={() => void renew()}
        >
          {pending() ? t("settings.hostedServers.openingCheckout") : t("settings.hostedServers.renew")}
        </props.menu.Item>
      </AlertActions>
    </Alert>
  );
}

function SadAgentsHero(props: { deleteAt: number | null }) {
  const { t } = useText();
  return (
    <div class="server-plan-dialog-hero">
      <div class="server-plan-dialog-agents">
        <For each={SAD_AGENTS}>
          {(agent) => <AgentAvatar seed={agent.seed} hue={agent.hue} mood="failed" class="server-plan-dialog-agent" />}
        </For>
      </div>
      <Show when={props.deleteAt}>
        {(deleteAt) => (
          <span class="server-plan-count server-plan-dialog-count">
            {t("server.plan.dialogDaysLeft", { count: serverPlanDaysLeft(deleteAt()) })}
          </span>
        )}
      </Show>
    </div>
  );
}

export function serverPlanBlocks(server: ServerSummary | undefined, deleteAt: number | null): boolean {
  if (server?.kind !== "remote" || server.hostedSleep || server.hostRestart?.state === "restarting") return false;
  if (server.hostedIssue === "plan_ended") return true;
  return deleteAt !== null && server.state !== "online" && server.state !== "connecting";
}

export function serverPlanScreenShown(
  server: ServerSummary | null,
  planDeletesAt: (serverId: string) => number | null,
): boolean {
  return server !== null && serverPlanBlocks(server, planDeletesAt(server.id));
}

export function ServerPlanEndedScreen(props: {
  server: ServerSummary;
  deleteAt: number | null;
  onRenew?: ((serverId: string) => Promise<void>) | undefined;
  onRetry: () => void;
}) {
  const { t, format } = useText();
  const [pending, setPending] = createSignal(false);
  const renewable = () => props.deleteAt !== null && props.onRenew !== undefined;
  async function renew(): Promise<void> {
    setPending(true);
    try {
      await props.onRenew?.(props.server.id);
    } finally {
      setPending(false);
    }
  }
  return (
    <main class="server-plan-screen" aria-labelledby="server-plan-screen-title">
      <SadAgentsHero deleteAt={props.deleteAt} />
      <h1 class="server-plan-screen-title" id="server-plan-screen-title">
        {t("server.connection.planEnded", { name: props.server.name })}
      </h1>
      <p class="server-plan-screen-description">
        <Show when={props.deleteAt} fallback={t("server.plan.ownerRenews", { name: props.server.name })}>
          {(deleteAt) =>
            t("server.plan.dialogDescription", {
              name: props.server.name,
              date: format.date(deleteAt(), { dateStyle: "long" }),
            })
          }
        </Show>
      </p>
      <div class="server-plan-screen-actions">
        <Button variant="outline" onClick={() => props.onRetry()}>
          {t("common.retry")}
        </Button>
        <Show when={renewable()}>
          <Button
            loading={pending()}
            loadingLabel={t("settings.hostedServers.openingCheckout")}
            onClick={() => void renew()}
          >
            {t("server.plan.keepAgents")}
          </Button>
        </Show>
      </div>
    </main>
  );
}

export interface ServerPlanEndedDialogProps {
  open: boolean;
  end: ServerPlanEnd | null;
  onLater: () => void;
  onRenew: (serverId: string) => Promise<void>;
}

export function ServerPlanEndedDialog(props: ServerPlanEndedDialogProps) {
  const { t, format } = useText();
  const description = () => {
    const current = props.end;
    if (!current) return undefined;
    return t("server.plan.dialogDescription", {
      name: current.server.name,
      date: format.date(current.deleteAt, { dateStyle: "long" }),
    });
  };
  return (
    <ConfirmDialog
      open={props.open && props.end !== null}
      class="server-plan-dialog"
      tone="default"
      media={<SadAgentsHero deleteAt={props.end?.deleteAt ?? null} />}
      title={t("server.plan.dialogTitle")}
      description={description()}
      cancelLabel={t("server.plan.later")}
      confirmLabel={t("server.plan.keepAgents")}
      pendingLabel={t("settings.hostedServers.openingCheckout")}
      onCancel={props.onLater}
      onConfirm={() => {
        const current = props.end;
        return current ? props.onRenew(current.server.id) : undefined;
      }}
    />
  );
}
