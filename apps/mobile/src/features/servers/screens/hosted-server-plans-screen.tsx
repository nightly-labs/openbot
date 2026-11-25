import { siteLimitForPlan } from "@openbot/contracts/billing";
import type { HostedServerCatalogPlan, HostedServerList, HostedServerSummary } from "@openbot/contracts/hosted-servers";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { skipToken, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Chip, Skeleton, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Monitor from "lucide-react-native/icons/monitor";
import Ticket from "lucide-react-native/icons/ticket";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import type { MobileSession } from "@/features/auth/api/mobile-auth";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import { LocalServerOptions } from "@/features/servers/components/local-server-options";
import {
  hostedServerListState,
  ownedHostedServers,
  rememberHostedServer,
  useHostedServerAvailability,
} from "@/features/servers/model/hosted-server-availability";
import { hostedServerInSetup, HOSTED_PLAN_TEXT as PLAN_TEXT } from "@/features/servers/model/hosted-server-plans";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { devFeatureOverride } from "@/shared/lib/dev-feature-overrides";
import { refreshMobileFeatures, useMobileFeature } from "@/shared/lib/mobile-features";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

const DATE_FORMAT = { dateStyle: "medium" } as const satisfies Intl.DateTimeFormatOptions;

function plansEntryPoint(value: unknown): "drawer" | "onboarding" | undefined {
  return value === "drawer" || value === "onboarding" ? value : undefined;
}

interface PlansData {
  plans: HostedServerCatalogPlan[];
  list: HostedServerList;
}

export function HostedServerPlansScreen() {
  const { t, errorMessage } = useText();
  const { entryPoint } = useLocalSearchParams<{ entryPoint?: string }>();
  useEffect(() => {
    const scope = mobileAnalytics.scope();
    const entry_point = plansEntryPoint(entryPoint);
    scope.track("hosted_server_plans_action", { action: "viewed", entry_point });
    return () => scope.track("hosted_server_plans_action", { action: "closed", entry_point });
  }, [entryPoint]);
  const { session } = useMobileSession();
  const queryScope = useQueryScope();
  const { servers } = useMobileWorkspace();
  const apiUrl = session?.apiUrl ?? null;
  const cloudServersOn = useMobileFeature(apiUrl ?? "", "cloudServers");
  const listedIds = useMemo(() => new Set(servers.map((server) => server.id)), [servers]);
  const load = useQuery({
    queryKey: queryKeys.hostedServerPlans(queryScope),
    queryFn: session ? () => readPlans(session) : skipToken,
    staleTime: 0,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  return (
    <PlansContent>
      {load.data ? (
        <PlansReady
          plans={load.data.plans}
          list={load.data.list}
          listedIds={listedIds}
          cloudServersOn={cloudServersOn}
        />
      ) : load.isError ? (
        <View className="items-center gap-4 px-4 pt-10">
          <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
            {errorMessage(load.error, t("mobile.server.hosted.loadFailed"))}
          </Typography.Paragraph>
          <Button size="lg" isDisabled={load.isFetching} onPress={() => void load.refetch()}>
            <Button.Label className="font-sans font-semibold">{t("common.tryAgain")}</Button.Label>
          </Button>
        </View>
      ) : (
        <PlansLoading />
      )}
    </PlansContent>
  );
}

function PlansReady({
  plans,
  list,
  listedIds,
  cloudServersOn,
}: {
  plans: HostedServerCatalogPlan[];
  list: HostedServerList;
  listedIds: ReadonlySet<string>;
  cloudServersOn: boolean;
}) {
  const { t } = useText();
  const owned = ownedHostedServers(list);
  const showPlans = (devFeatureOverride("cloudServers") ?? (list.available && cloudServersOn)) && plans.length > 0;
  const ownedPlans = new Set(owned.map((server) => server.plan));

  return (
    <>
      {showPlans ? (
        <PlansHeader description={t("mobile.server.hosted.intro.description")} />
      ) : owned.length === 0 ? (
        <PlansHeader description={t("mobile.server.hosted.unavailable")} />
      ) : null}

      {owned.length > 0 ? (
        <SettingsSection title={t("mobile.server.hosted.yourServers")}>
          {owned.map((server) => (
            <OwnedServerRow key={server.serverId} server={server} listed={listedIds.has(server.serverId)} />
          ))}
        </SettingsSection>
      ) : null}

      {showPlans ? <ComputerSteps showChangePlan={owned.length > 0} /> : null}

      {showPlans ? <PlanDetails plans={plans} ownedPlans={ownedPlans} /> : null}

      <LocalServerOptions pathname="/hosted-server/local" />
      <OtherOptions />
    </>
  );
}

function PlansContent({ children }: { children: ReactNode }) {
  return (
    <SheetScrollView
      scrollEdgeEffect={false}
      contentContainerClassName="gap-6 px-4 pb-safe-offset-5 pt-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </SheetScrollView>
  );
}

async function readPlans(session: MobileSession): Promise<PlansData> {
  const calls = hostedServerCalls(session);
  const [catalog, list] = await Promise.all([calls.plans(), calls.list(), refreshMobileFeatures(session.apiUrl, true)]);
  useHostedServerAvailability.setState({
    userId: session.user.id,
    ...hostedServerListState(list),
    checkedAt: Date.now(),
  });
  return { plans: catalog.plans, list };
}

function PlansLoading() {
  const { t } = useText();
  return (
    <View accessible accessibilityLabel={t("mobile.server.hosted.loading")} className="gap-6">
      <View className="items-center gap-2 px-4 pt-1">
        <Skeleton className="h-6 w-3/5 rounded-full" />
        <Skeleton className="h-4 w-4/5 rounded-full" />
        <Skeleton className="h-4 w-3/5 rounded-full" />
      </View>
      <View className="gap-2">
        <Skeleton className="mx-4 h-3 w-16 rounded-full" />
        <View className="overflow-hidden rounded-grouped bg-grouped">
          {[0, 1, 2].map((index) => (
            <View key={index}>
              {index > 0 ? <View className="ml-4 h-px bg-grouped-border" /> : null}
              <View className="gap-2 px-4 py-3">
                <Skeleton className="h-4 w-24 rounded-full" />
                <Skeleton className="h-3 w-4/5 rounded-full" />
                <Skeleton className="h-3 w-3/5 rounded-full" />
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function PlansHeader({ description }: { description: string }) {
  const { t } = useText();
  return (
    <View className="items-center gap-2 px-4 pt-1">
      <Typography.Heading type="h4" align="center">
        {t("mobile.server.hosted.intro.title")}
      </Typography.Heading>
      <Typography.Paragraph type="body-sm" align="center" className="max-w-80 text-text-secondary">
        {description}
      </Typography.Paragraph>
    </View>
  );
}

type OwnedServerState = "payment" | "setup" | "restoring" | "starting" | "running" | "stopped" | "planEnded" | "failed";

const OWNED_STATE_TEXT = {
  payment: "mobile.server.hosted.state.payment",
  setup: "mobile.server.hosted.state.setup",
  restoring: "mobile.server.hosted.state.restoring",
  starting: "mobile.server.hosted.state.starting",
  running: "mobile.server.hosted.state.running",
  stopped: "mobile.server.hosted.state.stopped",
  planEnded: "mobile.server.hosted.state.planEnded",
  failed: "mobile.server.hosted.state.failed",
} as const satisfies Record<OwnedServerState, MobileTextKey>;

function ownedServerState(server: HostedServerSummary): OwnedServerState {
  if (server.error === "plan_ended") return "planEnded";
  if (server.restoring) return "restoring";
  switch (server.state) {
    case "awaiting_payment":
      return "payment";
    case "creating":
    case "starting":
      return "setup";
    case "waking":
      return "starting";
    case "running":
      return "running";
    case "stopping":
    case "stopped":
      return "stopped";
    default:
      return "failed";
  }
}

function OwnedServerRow({ server, listed }: { server: HostedServerSummary; listed: boolean }) {
  const { t, format } = useText();
  const [muted] = useThemeColor(["muted"]);
  const state = ownedServerState(server);
  const plan = t(PLAN_TEXT[server.plan].name);
  const interval = server.interval === "year" ? t("mobile.server.hosted.yearly") : t("mobile.server.hosted.monthly");
  const supportingText =
    state === "planEnded" && server.dataKeptUntil
      ? t("mobile.server.hosted.serverDataKept", {
          plan,
          date: format.date(server.dataKeptUntil, DATE_FORMAT),
        })
      : server.deletionScheduledAt != null
        ? t("mobile.server.hosted.serverPlanEnds", {
            plan,
            interval,
            date: format.date(server.deletionScheduledAt, DATE_FORMAT),
          })
        : t("mobile.server.hosted.serverPlan", { plan, interval });
  const inSetup = hostedServerInSetup(server, listed);
  const label = (
    <Typography.Paragraph
      type="body-xs"
      className={
        state === "running"
          ? "text-success-text"
          : state === "failed" || state === "planEnded"
            ? "text-danger-text"
            : "text-text-secondary"
      }
    >
      {t(OWNED_STATE_TEXT[state])}
    </Typography.Paragraph>
  );
  return (
    <SettingsRow
      supportingText={supportingText}
      accessibilityLabel={`${server.name}, ${supportingText}, ${t(OWNED_STATE_TEXT[state])}`}
      trailing={
        inSetup ? (
          <View className="flex-row items-center gap-1">
            {label}
            <ChevronRight size={18} color={muted} strokeWidth={1.5} style={MIRROR_IN_RTL} />
          </View>
        ) : (
          label
        )
      }
      onPress={
        inSetup
          ? () => {
              rememberHostedServer(server);
              mobileAnalytics.track("hosted_server_plans_action", { action: "setup_opened" });
              router.push({ pathname: "/hosted-server/setup", params: { serverId: server.serverId } });
            }
          : undefined
      }
    >
      <Typography.Paragraph numberOfLines={1}>{server.name}</Typography.Paragraph>
    </SettingsRow>
  );
}

function OtherOptions() {
  const { t } = useText();
  const [foreground] = useThemeColor(["foreground"]);
  return (
    <SettingsSection>
      <SettingsRow
        leading={<Ticket color={foreground} size={22} strokeWidth={1.8} />}
        supportingText={t("mobile.server.hosted.joinHint")}
        onPress={() => router.push("/hosted-server/join")}
      >
        <Typography.Paragraph>{t("mobile.server.hosted.join")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

function PlanRow({ plan, current }: { plan: HostedServerCatalogPlan; current: boolean }) {
  const { t } = useText();
  const facts = t("mobile.server.hosted.planFacts", {
    members: t("mobile.server.hosted.members", { count: plan.memberLimit }),
    storage: t("mobile.server.hosted.storage", { count: plan.diskGb }),
    sites: t("mobile.server.hosted.sites", { count: siteLimitForPlan(plan.id) }),
    speed:
      plan.relativeSpeed === 1
        ? t("mobile.server.hosted.speedBase")
        : t("mobile.server.hosted.speedFaster", { factor: plan.relativeSpeed }),
  });
  return (
    <SettingsRow supportingText={facts}>
      <View className="flex-row items-center gap-2">
        <Typography.Paragraph weight="semibold">{t(PLAN_TEXT[plan.id].name)}</Typography.Paragraph>
        {current ? (
          <Chip size="sm" variant="soft" color="accent">
            <Chip.Label>{t("mobile.server.hosted.currentPlan")}</Chip.Label>
          </Chip>
        ) : null}
        {plan.soldOut && !current ? (
          <Chip size="sm" variant="soft">
            <Chip.Label>{t("mobile.server.hosted.soldOut")}</Chip.Label>
          </Chip>
        ) : null}
      </View>
      <Typography.Paragraph type="body-sm">{t(PLAN_TEXT[plan.id].summary)}</Typography.Paragraph>
    </SettingsRow>
  );
}

const COMPUTER_STEPS = [
  "mobile.server.hosted.steps.open",
  "mobile.server.hosted.steps.settings",
  "mobile.server.hosted.steps.add",
] as const satisfies readonly MobileTextKey[];

function ComputerSteps({ showChangePlan }: { showChangePlan: boolean }) {
  const { t, format } = useText();
  const accent = String(useCSSVariable("--openbot-accent-text"));
  return (
    <View className="gap-4 rounded-grouped bg-grouped p-4">
      <View className="flex-row items-center gap-3">
        <View className="size-11 items-center justify-center rounded-xl bg-accent/15">
          <Monitor color={accent} size={24} strokeWidth={1.8} />
        </View>
        <Typography.Paragraph weight="semibold" className="min-w-0 flex-1">
          {t("mobile.server.hosted.steps.title")}
        </Typography.Paragraph>
      </View>
      <View accessibilityRole="list" className="gap-3">
        {COMPUTER_STEPS.map((key, index) => (
          <View key={key} accessible className="flex-row gap-3">
            <View className="min-h-6 min-w-6 items-center justify-center rounded-full border border-grouped-border px-1.5">
              <Typography.Paragraph type="body-xs" weight="semibold" className="text-grouped-secondary">
                {format.number(index + 1)}
              </Typography.Paragraph>
            </View>
            <Typography.Paragraph className="min-w-0 flex-1">{t(key)}</Typography.Paragraph>
          </View>
        ))}
      </View>
      {showChangePlan ? (
        <View className="gap-1 border-t border-grouped-border pt-4">
          <Typography.Paragraph weight="semibold">{t("mobile.server.hosted.computer.change")}</Typography.Paragraph>
          <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
            {t("mobile.server.hosted.computer.changeHint")}
          </Typography.Paragraph>
        </View>
      ) : null}
    </View>
  );
}

function PlanDetails({
  plans,
  ownedPlans,
}: {
  plans: HostedServerCatalogPlan[];
  ownedPlans: ReadonlySet<HostedServerCatalogPlan["id"]>;
}) {
  const { t } = useText();
  const [muted] = useThemeColor(["muted"]);
  const [open, setOpen] = useState(false);
  const Disclosure = open ? ChevronDown : ChevronRight;
  return (
    <SettingsSection>
      <SettingsRow
        disclosure={false}
        expanded={open}
        trailing={<Disclosure size={18} color={muted} strokeWidth={1.5} style={open ? undefined : MIRROR_IN_RTL} />}
        onPress={() => setOpen((value) => !value)}
      >
        <Typography.Paragraph>{t("mobile.server.hosted.plansToggle")}</Typography.Paragraph>
      </SettingsRow>
      {open ? plans.map((entry) => <PlanRow key={entry.id} plan={entry} current={ownedPlans.has(entry.id)} />) : null}
    </SettingsSection>
  );
}
