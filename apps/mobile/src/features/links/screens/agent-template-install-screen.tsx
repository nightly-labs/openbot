import type { AgentTemplateDetail, RoutineSchedule } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Check, ChevronDown, ChevronRight } from "lucide-react-native";
import { type PropsWithChildren, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { ThinkingTextGradient } from "@/features/chat/components/thinking-text-gradient";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { serverStatusLabel } from "@/features/workspace/model/server-status";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { BlurReveal } from "@/shared/components/blur-reveal";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { isIOS } from "@/shared/lib/platform";
import { type MobileText, useText } from "@/shared/lib/text";
import { AgentTemplateNotFoundError, loadAgentTemplate } from "../api/agent-templates";
import { forgetIncomingLink, readIncomingLink } from "../model/incoming-links";

export function AgentTemplateInstallScreen() {
  const { request } = useLocalSearchParams<{ request?: string }>();
  return <AgentTemplateInstall key={request ?? "invalid"} request={request} />;
}

/**
 * The preview an agent link opens. It installs only when the user presses Add agent, on a server
 * where the user is an owner or admin and whose host advertises `agent-install-v1`.
 */
function AgentTemplateInstall({ request }: { request?: string }) {
  const { t, errorMessage } = useText();
  const { session } = useMobileSession();
  const workspace = useMobileWorkspace();
  const [link] = useState(() => readIncomingLink(request));
  useEffect(() => {
    forgetIncomingLink(request);
  }, [request]);
  const templateId = link.kind === "template" ? link.templateId : null;
  const apiUrl = session?.apiUrl ?? null;
  const template = useQuery({
    queryKey: ["agent-template", apiUrl, templateId],
    queryFn: ({ signal }) => {
      if (!apiUrl || !templateId) throw new AgentTemplateNotFoundError();
      return loadAgentTemplate(apiUrl, templateId, signal);
    },
    enabled: apiUrl !== null && templateId !== null,
    // Not cached: after an unpublish no copy may still show the instructions.
    gcTime: 0,
    retry: false,
  });
  // Owners and admins see each of their servers from the start. A server that is still connecting,
  // offline, or too old stays in the list as a disabled row, so the sheet does not change its layout.
  const managed = workspace.servers.filter((server) => server.role !== "member");
  const eligible = managed.filter(
    (server) => server.state === "online" && workspace.canInstallAgentTemplate(server.id),
  );
  const [chosenServerId, setChosenServerId] = useState<string | null>(null);
  const serverId =
    eligible.find((server) => server.id === chosenServerId)?.id ??
    eligible.find((server) => server.id === workspace.activeServer.id)?.id ??
    eligible[0]?.id ??
    null;
  const [installing, setInstalling] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  // Only while the request runs: after a success the sheet must close itself.
  usePreventRemove(installing && !finished, () => {
    // The host may already add the agent. Keep this sheet until the request settles.
  });
  useEffect(() => {
    if (finished) router.dismissTo("/connected");
  }, [finished]);

  function close(): void {
    if (router.canGoBack()) router.back();
    else router.replace("/connected");
  }

  async function install(detail: AgentTemplateDetail, target: string): Promise<void> {
    if (lock.current || finished) return;
    lock.current = true;
    setInstalling(true);
    setError(null);
    try {
      await workspace.installAgentTemplate(
        {
          templateId: detail.id,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          expectedUpdatedAt: detail.updatedAt,
        },
        target,
      );
      workspace.selectServer(target);
      // The agent list shows the new agent; a failed refresh does not make the install fail.
      void workspace.refreshServer(target).catch(() => undefined);
      setFinished(true);
      setInstalling(false);
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.link.template.install.failed")));
      lock.current = false;
      setInstalling(false);
    }
  }

  const detail = template.data ?? null;
  const canInstall = detail !== null && serverId !== null && !finished;

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={isIOS ? "xmark" : undefined}
          accessibilityLabel={t("common.close")}
          disabled={installing}
          onPress={close}
        >
          {isIOS ? t("common.close") : "×"}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <SheetSaveAction
        dirty={detail !== null}
        canSave={canInstall}
        pending={installing}
        label={t("mobile.link.template.install.action")}
        pendingLabel={t("mobile.link.template.install.pending")}
        onSave={() => {
          if (detail && serverId) void install(detail, serverId);
        }}
      />
      {templateId === null ? (
        <TemplateMessage
          title={t("mobile.link.unavailable.title")}
          description={t("mobile.link.unavailable.description")}
        />
      ) : template.isPending ? null : template.error instanceof AgentTemplateNotFoundError ? (
        <TemplateMessage
          title={t("mobile.link.template.notFound.title")}
          description={t("mobile.link.template.notFound.description")}
        />
      ) : template.isError ? (
        <View className="gap-3">
          <TemplateMessage
            title={t("mobile.link.template.error.title")}
            description={errorMessage(template.error, t("mobile.link.template.error.loadFailed"))}
          />
          <Button variant="secondary" onPress={() => void template.refetch()}>
            <Button.Label>{t("common.retry")}</Button.Label>
          </Button>
        </View>
      ) : null}
      {detail ? (
        <View className="gap-6">
          <TemplatePreview detail={detail} apiUrl={apiUrl} />
          <Cascade step={4}>
            <ServerChoices
              servers={managed}
              eligibleIds={new Set(eligible.map((server) => server.id))}
              selectedId={serverId}
              disabled={installing || finished}
              onSelect={setChosenServerId}
            />
          </Cascade>
        </View>
      ) : null}
      {/* Over the content, so its exit does not move the preview that comes in under it. */}
      <View pointerEvents="none" className="absolute inset-x-0 top-0">
        <BlurReveal value={templateId !== null && template.isPending ? t("mobile.link.template.loading") : null}>
          {(label) => <TemplateLoading label={label} />}
        </BlurReveal>
      </View>
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}

const CASCADE_START_MS = 140;
const CASCADE_STEP_MS = 70;

/**
 * One part of the preview. The parts come into focus from a blur one after another, from the top
 * down, after the loading label has gone.
 */
function Cascade({ step, children }: PropsWithChildren<{ step: number }>) {
  return (
    <BlurReveal value={step} interactive enterDuration={360} enterDelay={CASCADE_START_MS + step * CASCADE_STEP_MS}>
      {() => children}
    </BlurReveal>
  );
}

/** The label shines as the agent's thinking text does, while the account service answers. */
function TemplateLoading({ label }: { label: string }) {
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} className="items-center pt-12">
      <ThinkingTextGradient text={label} foreground={foreground} muted={muted} enabled fill={false}>
        <Typography.Paragraph type="body-sm" style={{ color: muted }}>
          {label}
        </Typography.Paragraph>
      </ThinkingTextGradient>
    </View>
  );
}

function TemplateMessage({ title, description }: { title: string; description: string }) {
  return (
    <View className="gap-2">
      <Typography.Heading type="h3">{title}</Typography.Heading>
      <Typography.Paragraph>{description}</Typography.Paragraph>
    </View>
  );
}

function TemplatePreview({ detail, apiUrl }: { detail: AgentTemplateDetail; apiUrl: string | null }) {
  const { t } = useText();
  // The account service sends the avatar as a path on its own origin.
  const avatarUrl = detail.avatarUrl && apiUrl ? new URL(detail.avatarUrl, apiUrl).toString() : null;
  return (
    <>
      <Cascade step={0}>
        <View className="items-center gap-1">
          <View className="mb-2">
            <BloubAvatarPreview seed={detail.avatarSeed} hue={detail.avatarHue} imageUrl={avatarUrl} size={72} />
          </View>
          <Typography.Heading type="h3" align="center">
            {detail.name}
          </Typography.Heading>
          <Typography.Paragraph type="body-sm" align="center" className="text-grouped-secondary">
            {t("mobile.link.template.creator", { name: detail.creatorName })}
          </Typography.Paragraph>
        </View>
      </Cascade>
      <Cascade step={1}>
        <SettingsSection title={t("mobile.link.template.section.instructions")}>
          <View className="gap-1 px-4 py-3">
            {detail.title ? <Typography.Paragraph>{detail.title}</Typography.Paragraph> : null}
            <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
              {detail.description}
            </Typography.Paragraph>
          </View>
        </SettingsSection>
      </Cascade>
      <Cascade step={2}>
        <SettingsSection title={t("mobile.link.template.section.skills")}>
          {detail.skills.length > 0 ? (
            detail.skills.map((skill) =>
              skill.kind === "embedded" ? (
                <EmbeddedSkill key={skill.slug} name={skill.name} markdown={skill.markdown} />
              ) : (
                <SettingsRow
                  key={skill.slug}
                  supportingText={t("mobile.link.template.skill.marketplace", { version: skill.version })}
                >
                  <Typography.Paragraph>{skill.name}</Typography.Paragraph>
                </SettingsRow>
              ),
            )
          ) : (
            <SettingsRow>
              <Typography.Paragraph className="text-grouped-secondary">
                {t("mobile.link.template.section.noSkills")}
              </Typography.Paragraph>
            </SettingsRow>
          )}
        </SettingsSection>
      </Cascade>
      <Cascade step={3}>
        <SettingsSection title={t("mobile.link.template.section.routines")}>
          {detail.routines.length > 0 ? (
            detail.routines.map((routine) => (
              <View key={routine.name} className="gap-1 px-4 py-3">
                <Typography.Paragraph>{routine.name}</Typography.Paragraph>
                <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                  {routineScheduleText(routine.schedule, routine.active, t)}
                </Typography.Paragraph>
                <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
                  {routine.instruction}
                </Typography.Paragraph>
              </View>
            ))
          ) : (
            <SettingsRow>
              <Typography.Paragraph className="text-grouped-secondary">
                {t("mobile.link.template.section.noRoutines")}
              </Typography.Paragraph>
            </SettingsRow>
          )}
        </SettingsSection>
      </Cascade>
    </>
  );
}

/** A local skill opens to show the `SKILL.md` text it installs, as on desktop. */
function EmbeddedSkill({ name, markdown }: { name: string; markdown: string }) {
  const { t } = useText();
  const [open, setOpen] = useState(false);
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        className="min-h-12 flex-row items-center gap-3 px-4 py-3"
      >
        <View className="min-w-0 flex-1 gap-1">
          <Typography.Paragraph>{name}</Typography.Paragraph>
          <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
            {t("mobile.link.template.skill.local")}
          </Typography.Paragraph>
        </View>
        <Chevron size={18} color={muted} strokeWidth={1.5} />
      </Pressable>
      {open ? (
        <Typography.Paragraph type="body-xs" className="px-4 pb-3 font-mono text-grouped-secondary">
          {markdown}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

const SCHEDULE_KEYS = {
  hourly: "mobile.agent.record.schedule.hourly",
  daily: "mobile.agent.record.schedule.daily",
  weekdays: "mobile.agent.record.schedule.weekdays",
  weekly: "mobile.agent.record.schedule.weekly",
  monthly: "mobile.agent.record.schedule.monthly",
} as const satisfies Partial<Record<RoutineSchedule["kind"], MobileTextKey>>;

function routineScheduleText(schedule: RoutineSchedule, active: boolean, t: MobileText["t"]): string {
  const parts =
    schedule.kind === "hourly" ||
    schedule.kind === "daily" ||
    schedule.kind === "weekdays" ||
    schedule.kind === "weekly" ||
    schedule.kind === "monthly"
      ? [t(SCHEDULE_KEYS[schedule.kind]), ...("time" in schedule ? [schedule.time] : [])]
      : [t("mobile.agent.record.schedule.custom")];
  if (!active) parts.push(t("mobile.agent.info.routinePaused"));
  return parts.join(" · ");
}

function ServerChoices({
  servers,
  eligibleIds,
  selectedId,
  disabled,
  onSelect,
}: {
  servers: MobileServer[];
  eligibleIds: ReadonlySet<string>;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (serverId: string) => void;
}) {
  const { t } = useText();
  const foreground = useThemeColor("foreground");
  return (
    <SettingsSection
      title={t("mobile.link.template.server.title")}
      footer={servers.length > 0 ? t("mobile.link.template.server.footer") : undefined}
    >
      {servers.length > 0 ? (
        servers.map((server) => {
          const eligible = eligibleIds.has(server.id);
          const reason =
            server.state !== "online"
              ? serverStatusLabel(server, t)
              : eligible
                ? null
                : t("mobile.link.template.server.updateRequired");
          return (
            <Pressable
              key={server.id}
              accessibilityRole="radio"
              accessibilityLabel={server.name}
              accessibilityHint={reason ?? undefined}
              accessibilityState={{ checked: server.id === selectedId, disabled: disabled || !eligible }}
              disabled={disabled || !eligible}
              onPress={() => onSelect(server.id)}
              className="min-h-12 flex-row items-center gap-3 px-4 py-3"
            >
              <View className={eligible ? "min-w-0 flex-1 gap-1" : "min-w-0 flex-1 gap-1 opacity-45"}>
                <Typography.Paragraph numberOfLines={1}>{server.name}</Typography.Paragraph>
                {reason ? (
                  <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                    {reason}
                  </Typography.Paragraph>
                ) : null}
              </View>
              {server.id === selectedId ? <Check size={18} color={foreground} strokeWidth={2} /> : null}
            </Pressable>
          );
        })
      ) : (
        <SettingsRow>
          <Typography.Paragraph className="text-grouped-secondary">
            {t("mobile.link.template.server.none")}
          </Typography.Paragraph>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}
