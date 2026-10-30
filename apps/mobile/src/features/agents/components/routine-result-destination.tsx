import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import ChevronsDownUp from "lucide-react-native/icons/chevrons-down-up";
import ChevronsUpDown from "lucide-react-native/icons/chevrons-up-down";
import { useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** A place to send to. The host adds the connection's name and platform when it saves. */
export interface RoutineResultChoice {
  connectionId: string;
  placeId: string;
  placeName: string;
}

interface PlaceGroup {
  connectionId: string;
  connectionName: string;
  places: RoutineResultChoice[];
  /** False for a saved place that its connection does not offer now. */
  available: boolean;
}

const samePlace = (left: RoutineResultChoice | null, right: RoutineResultChoice | null) =>
  left?.connectionId === right?.connectionId && left?.placeId === right?.placeId;

function Divider() {
  return <View className="ml-4 h-px bg-grouped-border" />;
}

function GroupLabel({ children }: { children: string }) {
  return (
    <View className="px-4 pb-1 pt-3">
      <Typography type="body-xs" className="text-grouped-secondary">
        {children}
      </Typography>
    </View>
  );
}

/**
 * Where an agent routine sends each answer, as well as to its chat, as on desktop. For a saved
 * routine, a press on a place saves it at once: the destination is a record of its own, apart from
 * the routine's draft. A new routine has no id yet, so `draft` keeps the choice until the routine
 * is created.
 */
export function RoutineResultDestinationSection({
  agentId,
  routineId,
  draft,
  serverId,
  disabled,
}: {
  agentId: string;
  serverId: string;
  disabled: boolean;
} & (
  | { routineId: string; draft?: undefined }
  | {
      routineId?: undefined;
      draft: { value: RoutineResultChoice | null; onChange: (choice: RoutineResultChoice | null) => void };
    }
)) {
  const { t, errorMessage } = useText();
  const workspace = useMobileWorkspaceActions();
  const client = useQueryClient();
  const queryScope = useQueryScope();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const accent = String(useCSSVariable("--openbot-accent"));
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destinationKey = queryKeys.agentRoutineResultDestination(queryScope, serverId, agentId, routineId ?? "");
  const options = useQuery({
    retry: false,
    queryKey: queryKeys.agentRoutineResultOptions(queryScope, serverId, agentId),
    queryFn: () => workspace.loadRoutineResultOptions(serverId),
  });
  const destination = useQuery({
    enabled: routineId !== undefined,
    retry: false,
    queryKey: destinationKey,
    queryFn: () => workspace.loadRoutineResultDestination({ agentId, routineId: routineId ?? "" }, serverId),
  });

  if (options.isError || destination.isError)
    return <SettingsNote>{t("mobile.agent.record.resultDestination.loadFailed")}</SettingsNote>;
  const value = draft ? draft.value : destination.data;
  if (!options.data || value === undefined) return null;
  // Typed here, so the handlers below keep the check above.
  const saved: RoutineResultChoice | null = value;
  /** Only a saved destination has the connection's name; a draft choice is always one that is offered. */
  const savedDestination = draft ? null : destination.data;
  const groups: PlaceGroup[] = options.data.map((connection) => ({
    connectionId: connection.connectionId,
    connectionName: connection.connectionName,
    places: connection.places.map((place) => ({
      connectionId: connection.connectionId,
      placeId: place.id,
      placeName: place.name,
    })),
    available: true,
  }));
  const savedOffered = saved && groups.some((group) => group.places.some((place) => samePlace(place, saved)));
  if (savedDestination && !savedOffered)
    groups.push({
      connectionId: savedDestination.connectionId,
      connectionName: savedDestination.connectionName,
      places: [savedDestination],
      available: false,
    });
  // As on desktop: with no connection and no saved place, there is nothing to choose.
  if (!groups.some((group) => group.places.length) && !saved) return null;
  const failed = options.data.filter((connection) => connection.placesFailed);
  const shown = open && !disabled && !pending;
  const Toggle = shown ? ChevronsDownUp : ChevronsUpDown;

  function choose(choice: RoutineResultChoice | null) {
    setOpen(false);
    if (samePlace(choice, saved) || pending) return;
    void haptics.selection();
    if (draft || routineId === undefined) {
      draft?.onChange(choice);
      return;
    }
    setPending(true);
    setError(null);
    workspace
      .setRoutineResultDestination({ agentId, routineId, destination: choice }, serverId)
      .then((next) => {
        client.setQueryData(destinationKey, next);
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.agent.record.resultDestination.saveFailed")));
      })
      .finally(() => setPending(false));
  }

  const savedTitle = saved
    ? savedOffered
      ? saved.placeName
      : t("mobile.agent.record.resultDestination.unavailable", { place: saved.placeName })
    : t("mobile.agent.record.resultDestination.none");
  const savedConnection = groups.find((group) => group.places.some((place) => samePlace(place, saved)));
  const option = (choice: RoutineResultChoice | null, title: string) => {
    const selected = samePlace(choice, saved);
    return (
      <View key={choice ? `${choice.connectionId}/${choice.placeId}` : "none"}>
        <Divider />
        <SettingsRow
          checked={selected}
          disclosure={false}
          trailing={selected ? <Check size={18} color={accent} strokeWidth={2} /> : null}
          onPress={() => choose(choice)}
        >
          <Typography.Paragraph numberOfLines={1}>{title}</Typography.Paragraph>
        </SettingsRow>
      </View>
    );
  };

  return (
    <View className="gap-2">
      <SettingsSection title={t("mobile.agent.record.resultDestination")}>
        <View>
          <SettingsRow
            disabled={disabled || pending}
            expanded={shown}
            supportingText={saved ? savedConnection?.connectionName : undefined}
            trailing={<Toggle size={18} color={muted} strokeWidth={1.5} />}
            onPress={() => setOpen((current) => !current)}
          >
            <Typography.Paragraph numberOfLines={1}>{savedTitle}</Typography.Paragraph>
          </SettingsRow>
          {shown ? (
            <>
              {option(null, t("mobile.agent.record.resultDestination.none"))}
              {groups.map((group) =>
                group.places.length ? (
                  <View key={`${group.connectionId}:${group.available}`}>
                    <Divider />
                    <GroupLabel>{group.connectionName}</GroupLabel>
                    {group.places.map((place) =>
                      option(
                        place,
                        group.available
                          ? place.placeName
                          : t("mobile.agent.record.resultDestination.unavailable", { place: place.placeName }),
                      ),
                    )}
                  </View>
                ) : null,
              )}
            </>
          ) : null}
        </View>
      </SettingsSection>
      {failed.map((connection) => (
        <SettingsNote key={connection.connectionId}>
          {t("mobile.agent.record.resultDestination.placesFailed", { connection: connection.connectionName })}
        </SettingsNote>
      ))}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
