import { analyticsRange, type InstalledSkill } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { type PropsWithChildren, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";
import { AgentFiles } from "./agent-files";
import { MemoryEditor, RoutineEditor } from "./agent-record-editor";
import { AgentSkills, CreateSkillAction } from "./agent-skills";
import { AgentUsageReport } from "./agent-usage-report";
import { UsageLoading } from "./usage-motion";
import { UsageRangePicker } from "./usage-range-picker";

type ListKind = "usage" | "memories" | "routines" | "skills" | "files";
type RecordKind = "memory" | "routine";

const LIST_SECTION_TEXT = {
  usage: {
    title: "mobile.agent.info.usage.title",
    loading: "mobile.agent.info.usage.loading",
    reconnect: "mobile.agent.info.usage.reconnect",
    failed: "mobile.agent.info.usage.failed",
    retry: "mobile.agent.info.usage.retry",
  },
  memories: {
    title: "mobile.agent.info.memories.title",
    loading: "mobile.agent.info.memories.loading",
    reconnect: "mobile.agent.info.memories.reconnect",
    failed: "mobile.agent.info.memories.failed",
    retry: "mobile.agent.info.memories.retry",
  },
  routines: {
    title: "mobile.agent.info.routines.title",
    loading: "mobile.agent.info.routines.loading",
    reconnect: "mobile.agent.info.routines.reconnect",
    failed: "mobile.agent.info.routines.failed",
    retry: "mobile.agent.info.routines.retry",
  },
  skills: {
    title: "mobile.agent.info.skills.title",
    loading: "mobile.agent.info.skills.loading",
    reconnect: "mobile.agent.info.skills.reconnect",
    failed: "mobile.agent.info.skills.failed",
    retry: "mobile.agent.info.skills.retry",
  },
  files: {
    title: "mobile.agent.info.files.title",
    loading: "mobile.agent.info.files.loading",
    reconnect: "mobile.agent.info.files.reconnect",
    failed: "mobile.agent.info.files.failed",
    retry: "mobile.agent.info.files.retry",
  },
} as const satisfies Record<
  ListKind,
  {
    title: MobileTextKey;
    loading: MobileTextKey;
    reconnect: MobileTextKey;
    failed: MobileTextKey;
    retry: MobileTextKey;
  }
>;

const RECORD_SECTION_TEXT = {
  memory: {
    loading: "mobile.agent.info.memory.loading",
    failed: "mobile.agent.info.memory.failed",
    retry: "mobile.agent.info.memory.retry",
  },
  routine: {
    loading: "mobile.agent.info.routine.loading",
    failed: "mobile.agent.info.routine.failed",
    retry: "mobile.agent.info.routine.retry",
  },
} as const satisfies Record<RecordKind, { loading: MobileTextKey; failed: MobileTextKey; retry: MobileTextKey }>;

export function AgentInformation({
  agent,
  available,
  section,
}: {
  agent: MobileAgent;
  available: boolean;
  section: "usage" | "memories" | "routines" | "memory" | "routine" | "skills" | "files";
}) {
  useEffect(() => {
    if (section === "usage") mobileAnalytics.track("usage_viewed", {});
  }, [section]);
  const { t } = useText();
  const { recordId } = useLocalSearchParams<{ recordId?: string }>();
  const workspace = useMobileWorkspace();
  const role = workspace.servers.find((server) => server.id === agent.serverId)?.role;
  const { session, sessionScope } = useMobileSession();
  const [range, setRange] = useState(() => analyticsRange(agent.id));
  const key = ["agent-info", session?.apiUrl, session?.user.id, sessionScope, agent.serverId, agent.id];
  const options = { enabled: available, retry: false, staleTime: 0, gcTime: 0 };
  const memories = useQuery({
    ...options,
    enabled: available && (section === "memories" || section === "memory"),
    queryKey: [...key, "memories"],
    queryFn: () => workspace.loadAgentMemories(agent.id, agent.serverId),
  });
  const routines = useQuery({
    ...options,
    enabled: available && (section === "routines" || section === "routine"),
    queryKey: [...key, "routines"],
    queryFn: () => workspace.loadAgentRoutines(agent.id, agent.serverId),
  });
  const eventsEnabled =
    available &&
    (section === "routines" || section === "routine") &&
    (role === "owner" || role === "admin") &&
    workspace.canManageEvents(agent.serverId);
  const eventRoutines = useQuery({
    ...options,
    enabled: eventsEnabled,
    queryKey: [...key, "event-routines"],
    queryFn: () => workspace.listEventRoutines({ kind: "agent", id: agent.id }, agent.serverId),
  });
  const allRoutines = [
    ...(routines.data ?? []),
    ...(eventRoutines.data ?? []).filter((routine) => routine.trigger.kind === "webhook"),
  ];
  // An owner or admin reads the admin list, which has the enabled state, and can change it.
  const manageSkills = workspace.canManageAgentSkills(agent.serverId);
  const skillsKey = [...key, "skills", manageSkills];
  const skills = useQuery({
    ...options,
    enabled: available && section === "skills",
    queryKey: skillsKey,
    queryFn: async () => {
      const installed = await workspace.loadAgentSkills(agent.id, agent.serverId, manageSkills);
      return installed && userAssignedSkills(installed);
    },
  });
  // The host caches a scan. A retry or a deletion measures again, as on desktop.
  const forceStorageScan = useRef(false);
  const storage = useQuery({
    ...options,
    enabled: available && section === "files",
    queryKey: [...key, "storage"],
    queryFn: () => {
      const force = forceStorageScan.current;
      forceStorageScan.current = false;
      return workspace.loadAgentStorage(agent.id, agent.serverId, force);
    },
  });
  function rescanStorage() {
    forceStorageScan.current = true;
    void storage.refetch();
  }
  const usage = useQuery({
    ...options,
    enabled: available && section === "usage",
    queryKey: [...key, "usage", available, range],
    // The last report stays on screen while the next range loads, so its values change in place.
    placeholderData: keepPreviousData,
    // As on desktop, the agent page reads the host report with an agent filter: it splits the days by
    // provider. A host without `host-analytics` still answers the agent report, which draws one area.
    queryFn: async () =>
      (await workspace.loadHostAnalytics(range, agent.serverId)) ?? workspace.loadAgentAnalytics(range, agent.serverId),
  });
  return (
    <>
      {section === "usage" ? (
        <View className="gap-4">
          <UsageRangePicker range={range} onChange={(selected) => setRange({ ...selected, agentId: agent.id })} />
          <InformationSection
            kind="usage"
            list
            available={available}
            pending={usage.isPending}
            failed={usage.isError}
            retry={() => void usage.refetch()}
          >
            {usage.data ? (
              <UsageLoading loading={usage.isPlaceholderData}>
                <AgentUsageReport result={usage.data} />
              </UsageLoading>
            ) : (
              <Typography.Paragraph>{t("mobile.agent.usage.unsupported")}</Typography.Paragraph>
            )}
          </InformationSection>
        </View>
      ) : null}
      {section === "memories" ? (
        <InformationSection
          kind="memories"
          list
          available={available}
          pending={memories.isPending}
          failed={memories.isError}
          retry={() => void memories.refetch()}
        >
          {memories.data?.map((memory) => (
            <SettingsRow
              key={memory.id}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/memory",
                  params: { agentId: agent.id, serverId: agent.serverId, recordId: memory.id },
                })
              }
            >
              <Typography.Paragraph numberOfLines={2}>{memory.text}</Typography.Paragraph>
            </SettingsRow>
          ))}
          {!memories.data?.length ? (
            <SettingsRow>
              <Typography.Paragraph className="text-grouped-secondary">
                {t("mobile.agent.info.noMemories")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          <SettingsRow
            onPress={() =>
              router.push({
                pathname: "/agent-info/[agentId]/memory",
                params: { agentId: agent.id, serverId: agent.serverId },
              })
            }
          >
            <Typography.Paragraph>{t("mobile.agent.info.addMemory")}</Typography.Paragraph>
          </SettingsRow>
        </InformationSection>
      ) : null}
      {section === "routines" ? (
        <InformationSection
          kind="routines"
          list
          available={available}
          pending={routines.isPending || (eventsEnabled && eventRoutines.isPending)}
          failed={routines.isError || (eventsEnabled && eventRoutines.isError)}
          retry={() => {
            void routines.refetch();
            if (eventsEnabled) void eventRoutines.refetch();
          }}
        >
          {allRoutines.map((routine) => (
            <SettingsRow
              key={routine.id}
              supportingText={t(routine.active ? "mobile.agent.info.routineActive" : "mobile.agent.info.routinePaused")}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/routine",
                  params: { agentId: agent.id, serverId: agent.serverId, recordId: routine.id },
                })
              }
            >
              <Typography.Paragraph numberOfLines={1}>{routine.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
          {!allRoutines.length ? (
            <SettingsRow>
              <Typography.Paragraph className="text-grouped-secondary">
                {t("mobile.agent.info.noRoutines")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          <SettingsRow
            onPress={() =>
              router.push({
                pathname: "/agent-info/[agentId]/routine",
                params: { agentId: agent.id, serverId: agent.serverId },
              })
            }
          >
            <Typography.Paragraph>{t("mobile.agent.info.addRoutine")}</Typography.Paragraph>
          </SettingsRow>
        </InformationSection>
      ) : null}
      {section === "skills" ? (
        <>
          {available && manageSkills ? <CreateSkillAction agent={agent} /> : null}
          <InformationSection
            kind="skills"
            list
            available={available}
            pending={skills.isPending}
            failed={skills.isError}
            retry={() => void skills.refetch()}
          >
            {skills.data === null ? (
              <SettingsSection>
                <SettingsRow>
                  <Typography.Paragraph>{t("mobile.agent.info.skillsUnsupported")}</Typography.Paragraph>
                </SettingsRow>
              </SettingsSection>
            ) : skills.data ? (
              <AgentSkills agent={agent} skills={skills.data} manage={manageSkills} queryKey={skillsKey} />
            ) : null}
          </InformationSection>
          <SettingsNote>
            {t(manageSkills ? "mobile.agent.info.skillsAddOnComputer" : "mobile.agent.info.skillsManaged")}
          </SettingsNote>
        </>
      ) : null}
      {section === "files" ? (
        <InformationSection
          kind="files"
          list
          available={available}
          pending={storage.isPending}
          failed={storage.isError}
          retry={rescanStorage}
        >
          {storage.data ? (
            <AgentFiles
              agent={agent}
              usage={storage.data}
              canDelete={role === "owner" || role === "admin"}
              onChanged={rescanStorage}
            />
          ) : (
            <SettingsSection>
              <SettingsRow>
                <Typography.Paragraph>{t("mobile.agent.info.filesUnsupported")}</Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
          )}
        </InformationSection>
      ) : null}
      {section === "memory" ? (
        !recordId ? (
          <MemoryEditor agent={agent} available={available} />
        ) : (
          <RecordSection
            kind="memory"
            available={available}
            pending={memories.isPending}
            failed={memories.isError}
            retry={() => void memories.refetch()}
          >
            {memories.data?.some((item) => item.id === recordId) ? (
              <MemoryEditor
                key={recordId}
                agent={agent}
                available={available && !memories.isError}
                memory={memories.data.find((item) => item.id === recordId)}
              />
            ) : (
              <SettingsRow>
                <Typography.Paragraph>{t("mobile.agent.info.memoryGone")}</Typography.Paragraph>
              </SettingsRow>
            )}
          </RecordSection>
        )
      ) : null}
      {section === "routine" ? (
        !recordId ? (
          <RoutineEditor agent={agent} available={available} />
        ) : (
          <RecordSection
            kind="routine"
            available={available}
            pending={routines.isPending || (eventsEnabled && eventRoutines.isPending)}
            failed={routines.isError || (eventsEnabled && eventRoutines.isError)}
            retry={() => {
              void routines.refetch();
              if (eventsEnabled) void eventRoutines.refetch();
            }}
          >
            {allRoutines.some((item) => item.id === recordId) ? (
              <RoutineEditor
                key={recordId}
                agent={agent}
                available={available && !routines.isError && !(eventsEnabled && eventRoutines.isError)}
                routine={allRoutines.find((item) => item.id === recordId)}
              />
            ) : (
              <SettingsRow>
                <Typography.Paragraph>{t("mobile.agent.info.routineGone")}</Typography.Paragraph>
              </SettingsRow>
            )}
          </RecordSection>
        )
      ) : null}
    </>
  );
}

function RecordSection({
  kind,
  available,
  pending,
  failed,
  retry,
  children,
}: PropsWithChildren<{
  kind: RecordKind;
  available: boolean;
  pending: boolean;
  failed: boolean;
  retry: () => void;
}>) {
  const { t } = useText();
  const text = RECORD_SECTION_TEXT[kind];
  return (
    <View className="gap-4">
      {!pending ? children : null}
      {!available ? (
        <Typography.Paragraph>{t("mobile.agent.info.reconnectToSave")}</Typography.Paragraph>
      ) : pending ? (
        <Typography.Paragraph>{t(text.loading)}</Typography.Paragraph>
      ) : failed ? (
        <View className="gap-2">
          <Typography.Paragraph accessibilityRole="alert">{t(text.failed)}</Typography.Paragraph>
          <Button variant="ghost" onPress={retry}>
            <Button.Label>{t(text.retry)}</Button.Label>
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function InformationSection({
  kind,
  list = false,
  available,
  pending,
  failed,
  retry,
  children,
}: PropsWithChildren<{
  kind: ListKind;
  list?: boolean;
  available: boolean;
  pending: boolean;
  failed: boolean;
  retry: () => void;
}>) {
  const { t } = useText();
  const text = LIST_SECTION_TEXT[kind];
  if (list && available && !pending && !failed)
    return kind === "memories" || kind === "routines" ? <SettingsSection>{children}</SettingsSection> : children;
  return (
    <SettingsSection title={t(text.title)}>
      <SettingsRow>
        <View className="gap-2">
          {!available ? (
            <Typography.Paragraph>{t(text.reconnect)}</Typography.Paragraph>
          ) : pending ? (
            <Typography.Paragraph>{t(text.loading)}</Typography.Paragraph>
          ) : failed ? (
            <>
              <Typography.Paragraph accessibilityRole="alert">{t(text.failed)}</Typography.Paragraph>
              <Button variant="ghost" onPress={retry}>
                <Button.Label>{t(text.retry)}</Button.Label>
              </Button>
            </>
          ) : (
            children
          )}
        </View>
      </SettingsRow>
    </SettingsSection>
  );
}

/** The skills the user assigned, as the desktop agent settings list them: built-in skills are hidden. */
function userAssignedSkills(skills: InstalledSkill[]): InstalledSkill[] {
  return skills
    .filter(
      (skill) =>
        skill.origin !== "managed" && skill.slug !== "openbot-site-hosting" && skill.skillId !== "openbot-site-hosting",
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}
