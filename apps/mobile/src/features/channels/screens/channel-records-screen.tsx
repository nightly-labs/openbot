import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { MemoryEditor, RoutineEditor } from "@/features/agents/components/agent-record-editor";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useChannels } from "@/features/channels/components/use-channels";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

export function ChannelRecordsScreen({ section }: { section: "memories" | "memory" | "routines" | "routine" }) {
  const { t } = useText();
  const { channelId, serverId, recordId } = useLocalSearchParams<{
    channelId: string;
    serverId: string;
    recordId?: string;
  }>();
  const { session, sessionScope } = useMobileSession();
  const { servers } = useMobileWorkspace();
  const { store, channels } = useChannels(serverId);
  const available =
    servers.some((server) => server.id === serverId && server.state === "online") &&
    channels.some((channel) => channel.id === channelId);
  const key = ["channel-info", session?.apiUrl ?? "", session?.user.id ?? "", sessionScope, serverId, channelId];
  const memorySection = section === "memories" || section === "memory";
  const options = { enabled: available, retry: false, staleTime: 0, gcTime: 0 };
  const memories = useQuery({
    ...options,
    enabled: available && memorySection,
    queryKey: [...key, "memories"],
    queryFn: () => store.memories(serverId, channelId),
  });
  const routines = useQuery({
    ...options,
    enabled: available && !memorySection,
    queryKey: [...key, "routines"],
    queryFn: () => store.routines(serverId, channelId),
  });
  const query = memorySection ? memories : routines;
  const target = { id: channelId, serverId };
  const memory = memories.data?.find((item) => item.id === recordId);
  const routine = routines.data?.find((item) => item.id === recordId);
  return (
    <SettingsContent>
      {!available ? <Typography.Paragraph>{t("mobile.channel.records.connect")}</Typography.Paragraph> : null}
      {query.isPending && (Boolean(recordId) || section === "memories" || section === "routines") ? (
        <Typography.Paragraph>{t("common.loading")}</Typography.Paragraph>
      ) : query.isError && !query.data ? (
        <>
          <Typography.Paragraph accessibilityRole="alert">
            {t("mobile.channel.records.loadFailed")}
          </Typography.Paragraph>
          <Button onPress={() => void query.refetch()}>
            <Button.Label>{t("common.tryAgain")}</Button.Label>
          </Button>
        </>
      ) : recordId && !memory && !routine ? (
        <Typography.Paragraph>{t("mobile.channel.records.gone")}</Typography.Paragraph>
      ) : section === "memory" ? (
        <MemoryEditor
          agent={target}
          memory={memory}
          available={available}
          port={{
            queryKey: key,
            save: (text, id) => store.saveMemory(serverId, channelId, text, id),
            delete: (id) => store.deleteMemory(serverId, channelId, id),
          }}
        />
      ) : section === "routine" ? (
        <RoutineEditor
          agent={target}
          routine={routine}
          available={available}
          port={{
            queryKey: key,
            create: (input) => store.createRoutine(serverId, { ...input, channelId }),
            update: (input) => store.updateRoutine(serverId, { ...input, channelId }),
            delete: (id) => store.deleteRoutine(serverId, channelId, id),
            test: (id) => store.testRoutine(serverId, channelId, id),
          }}
        />
      ) : (
        <SettingsSection>
          {memorySection
            ? memories.data?.map((item) => (
                <SettingsRow
                  key={item.id}
                  onPress={() =>
                    router.push({
                      pathname: "/channel-info/[channelId]/memory",
                      params: { channelId, serverId, recordId: item.id },
                    })
                  }
                >
                  <Typography.Paragraph numberOfLines={2}>{item.text}</Typography.Paragraph>
                </SettingsRow>
              ))
            : routines.data?.map((item) => (
                <SettingsRow
                  key={item.id}
                  supportingText={t(item.active ? "mobile.channel.records.enabled" : "mobile.channel.records.paused")}
                  onPress={() =>
                    router.push({
                      pathname: "/channel-info/[channelId]/routine",
                      params: { channelId, serverId, recordId: item.id },
                    })
                  }
                >
                  <Typography.Paragraph>{item.name}</Typography.Paragraph>
                </SettingsRow>
              ))}
          {!query.data?.length ? (
            <SettingsRow>
              <Typography.Paragraph>
                {t(memorySection ? "mobile.channel.records.noMemories" : "mobile.channel.records.noRoutines")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          <SettingsRow
            onPress={() =>
              router.push({
                pathname: memorySection ? "/channel-info/[channelId]/memory" : "/channel-info/[channelId]/routine",
                params: { channelId, serverId },
              })
            }
          >
            <Typography.Paragraph>
              {t(memorySection ? "mobile.channel.records.addMemory" : "mobile.channel.records.addRoutine")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      )}
    </SettingsContent>
  );
}
