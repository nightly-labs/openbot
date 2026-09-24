import { analyticsRange, type InstalledSkill, parseAnalyticsRange } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { type PropsWithChildren, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { AgentFiles } from "./agent-files";
import { MemoryEditor, RoutineEditor } from "./agent-record-editor";
import { AgentUsageReport } from "./agent-usage-report";

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
  const { recordId } = useLocalSearchParams<{ recordId?: string }>();
  const workspace = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const [days, setDays] = useState(30);
  const [range, setRange] = useState(() => analyticsRange(agent.id));
  const [custom, setCustom] = useState(false);
  const [customStart, setCustomStart] = useState(range.startDate);
  const [customEnd, setCustomEnd] = useState(range.endDate);
  const [rangeError, setRangeError] = useState<string | null>(null);
  function applyCustomRange() {
    try {
      const selected = parseAnalyticsRange({ startDate: customStart, endDate: customEnd, timeZone: range.timeZone });
      setRange({ ...selected, agentId: agent.id });
      setDays(0);
      setRangeError(null);
    } catch {
      setRangeError(
        "Enter valid dates in YYYY-MM-DD format, with the start on or before the end. Select at most 367 days.",
      );
    }
  }
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
  const skills = useQuery({
    ...options,
    enabled: available && section === "skills",
    queryKey: [...key, "skills"],
    queryFn: async () => {
      const installed = await workspace.loadAgentSkills(agent.id, agent.serverId);
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
  const role = workspace.servers.find((server) => server.id === agent.serverId)?.role;
  const usage = useQuery({
    ...options,
    enabled: available && section === "usage",
    queryKey: [...key, "usage", available, range],
    queryFn: () => workspace.loadAgentAnalytics(range, agent.serverId),
  });
  return (
    <>
      {section === "usage" ? (
        <View className="gap-4">
          <View className="flex-row gap-2">
            {[7, 30, 90, 365].map((value) => (
              <Button
                key={value}
                className="flex-1"
                size="sm"
                variant={days === value ? "secondary" : "ghost"}
                accessibilityState={{ selected: days === value }}
                onPress={() => {
                  setCustom(false);
                  setRangeError(null);
                  setDays(value);
                  setRange(analyticsRange(agent.id, value));
                }}
              >
                <Button.Label>{value === 365 ? "1 year" : `${value} days`}</Button.Label>
              </Button>
            ))}
          </View>
          <Button
            variant="ghost"
            accessibilityState={{ expanded: custom }}
            onPress={() => {
              if (!custom) {
                setCustomStart(range.startDate);
                setCustomEnd(range.endDate);
              }
              setRangeError(null);
              setCustom(!custom);
            }}
          >
            <Button.Label>Custom range</Button.Label>
          </Button>
          {custom ? (
            <View className="gap-3">
              <SheetFormField
                label="Start date"
                hint="YYYY-MM-DD"
                appearance="soft"
                value={customStart}
                onChangeText={setCustomStart}
                autoCorrect={false}
                maxLength={10}
              />
              <SheetFormField
                label="End date"
                hint="YYYY-MM-DD"
                appearance="soft"
                value={customEnd}
                onChangeText={setCustomEnd}
                autoCorrect={false}
                maxLength={10}
              />
              {rangeError ? (
                <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
                  {rangeError}
                </Typography.Paragraph>
              ) : null}
              <Button variant="secondary" onPress={applyCustomRange}>
                <Button.Label>Apply range</Button.Label>
              </Button>
            </View>
          ) : null}
          <InformationSection
            title="Usage"
            list
            available={available}
            pending={usage.isPending}
            failed={usage.isError}
            retry={() => void usage.refetch()}
          >
            {usage.data ? (
              <AgentUsageReport result={usage.data} />
            ) : (
              <Typography.Paragraph>This host does not support agent analytics.</Typography.Paragraph>
            )}
          </InformationSection>
        </View>
      ) : null}
      {section === "memories" ? (
        <InformationSection
          title="Memories"
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
              <Typography.Paragraph className="text-grouped-secondary">No memories yet.</Typography.Paragraph>
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
            <Typography.Paragraph>Add memory</Typography.Paragraph>
          </SettingsRow>
        </InformationSection>
      ) : null}
      {section === "routines" ? (
        <InformationSection
          title="Routines"
          list
          available={available}
          pending={routines.isPending}
          failed={routines.isError}
          retry={() => void routines.refetch()}
        >
          {routines.data?.map((routine) => (
            <SettingsRow
              key={routine.id}
              supportingText={routine.active ? "Active" : "Paused"}
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
          {!routines.data?.length ? (
            <SettingsRow>
              <Typography.Paragraph className="text-grouped-secondary">No routines yet.</Typography.Paragraph>
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
            <Typography.Paragraph>Add routine</Typography.Paragraph>
          </SettingsRow>
        </InformationSection>
      ) : null}
      {section === "skills" ? (
        <>
          <InformationSection
            title="Skills"
            list
            available={available}
            pending={skills.isPending}
            failed={skills.isError}
            retry={() => void skills.refetch()}
          >
            {skills.data === null ? (
              <SettingsRow>
                <Typography.Paragraph>
                  This host does not support skills. Update OpenBot on the host.
                </Typography.Paragraph>
              </SettingsRow>
            ) : null}
            {skills.data?.map((skill) => (
              <SettingsRow key={skill.skillId} supportingText={skillMeta(skill)}>
                <Typography.Paragraph numberOfLines={1}>{skill.name}</Typography.Paragraph>
                {skill.description ? (
                  <Typography.Paragraph type="body-xs" numberOfLines={3} className="text-grouped-secondary">
                    {skill.description}
                  </Typography.Paragraph>
                ) : null}
              </SettingsRow>
            ))}
            {skills.data?.length === 0 ? (
              <SettingsRow>
                <Typography.Paragraph className="text-grouped-secondary">No skills yet.</Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </InformationSection>
          <SettingsNote>Skills for this agent are managed on the host.</SettingsNote>
        </>
      ) : null}
      {section === "files" ? (
        <InformationSection
          title="Files"
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
                <Typography.Paragraph>
                  This host does not support file management. Update OpenBot on the host.
                </Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
          )}
        </InformationSection>
      ) : null}
      {section === "memory" ? (
        !recordId ? (
          <MemoryEditor agent={agent} available={available} />
        ) : (
          <InformationSection
            title="Memory"
            list
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
                <Typography.Paragraph>This memory is no longer available.</Typography.Paragraph>
              </SettingsRow>
            )}
          </InformationSection>
        )
      ) : null}
      {section === "routine" ? (
        !recordId ? (
          <RoutineEditor agent={agent} available={available} />
        ) : (
          <InformationSection
            title="Routine"
            list
            available={available}
            pending={routines.isPending}
            failed={routines.isError}
            retry={() => void routines.refetch()}
          >
            {routines.data?.some((item) => item.id === recordId) ? (
              <RoutineEditor
                key={recordId}
                agent={agent}
                available={available && !routines.isError}
                routine={routines.data.find((item) => item.id === recordId)}
              />
            ) : (
              <SettingsRow>
                <Typography.Paragraph>This routine is no longer available.</Typography.Paragraph>
              </SettingsRow>
            )}
          </InformationSection>
        )
      ) : null}
    </>
  );
}

function InformationSection({
  title,
  list = false,
  available,
  pending,
  failed,
  retry,
  children,
}: PropsWithChildren<{
  title: string;
  list?: boolean;
  available: boolean;
  pending: boolean;
  failed: boolean;
  retry: () => void;
}>) {
  if (list && (title === "Memory" || title === "Routine")) {
    return (
      <View className="gap-4">
        {!pending ? children : null}
        {!available ? (
          <Typography.Paragraph>Reconnect to save changes.</Typography.Paragraph>
        ) : pending ? (
          <Typography.Paragraph>Loading {title.toLowerCase()}…</Typography.Paragraph>
        ) : failed ? (
          <View className="gap-2">
            <Typography.Paragraph accessibilityRole="alert">
              Could not refresh {title.toLowerCase()}.
            </Typography.Paragraph>
            <Button variant="ghost" onPress={retry}>
              <Button.Label>Retry {title.toLowerCase()}</Button.Label>
            </Button>
          </View>
        ) : null}
      </View>
    );
  }
  if (list && available && !pending && !failed)
    return title === "Memories" || title === "Routines" || title === "Skills" ? (
      <SettingsSection>{children}</SettingsSection>
    ) : (
      children
    );
  return (
    <SettingsSection title={title}>
      <SettingsRow>
        <View className="gap-2">
          {!available ? (
            <Typography.Paragraph>Reconnect to load {title.toLowerCase()}.</Typography.Paragraph>
          ) : pending ? (
            <Typography.Paragraph>Loading {title.toLowerCase()}…</Typography.Paragraph>
          ) : failed ? (
            <>
              <Typography.Paragraph accessibilityRole="alert">
                Could not load {title.toLowerCase()}.
              </Typography.Paragraph>
              <Button variant="ghost" onPress={retry}>
                <Button.Label>Retry {title.toLowerCase()}</Button.Label>
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

function skillMeta(skill: InstalledSkill): string {
  const parts = [
    skill.origin === "workspace" ? (skill.location ?? "Workspace folder") : `v${skill.installedVersion}`,
    skill.state === "update-available" ? `v${skill.availableVersion} available` : null,
    skill.state === "needs-repair" ? "Needs repair" : null,
    skill.state === "modified" ? "Modified" : null,
    skill.enabled === false ? "Disabled" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
