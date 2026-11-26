import type { RoutineResultConnectionOption, RoutineResultDestination } from "@openbot/contracts/ipc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Text } from "@openbot/ui";
import { For } from "solid-js";
import { useText } from "../../text";

export interface RoutineResultChoice {
  connectionId: string;
  placeId: string;
  placeName: string;
}

interface RoutineResultDestinationFieldProps {
  options: RoutineResultConnectionOption[];
  saved: RoutineResultDestination | null;
  value: RoutineResultChoice | null;
  onChange: (choice: RoutineResultChoice | null) => void;
}

const NONE = "none";

interface PlaceEntry {
  key: string;
  choice: RoutineResultChoice;
  connectionName: string;
  available: boolean;
}

function placeKey(choice: { connectionId: string; placeId: string }): string {
  return `${encodeURIComponent(choice.connectionId)}/${encodeURIComponent(choice.placeId)}`;
}

export function RoutineResultDestinationField(props: RoutineResultDestinationFieldProps) {
  const { t } = useText();
  const entries = (): PlaceEntry[] => {
    const offered = props.options.flatMap((connection) =>
      connection.places.map((place) => ({
        key: placeKey({ connectionId: connection.connectionId, placeId: place.id }),
        choice: { connectionId: connection.connectionId, placeId: place.id, placeName: place.name },
        connectionName: connection.connectionName,
        available: true,
      })),
    );
    const saved = props.saved;
    if (!saved || offered.some((entry) => entry.key === placeKey(saved))) return offered;
    return [
      ...offered,
      {
        key: placeKey(saved),
        choice: { connectionId: saved.connectionId, placeId: saved.placeId, placeName: saved.placeName },
        connectionName: saved.connectionName,
        available: false,
      },
    ];
  };
  const entry = (key: string) => entries().find((candidate) => candidate.key === key);
  const label = (key: string) => {
    const found = entry(key);
    if (!found) return t("routine.settings.resultDestination.none");
    const place = t("routine.settings.resultDestination.place", {
      connection: found.connectionName,
      place: found.choice.placeName,
    });
    return found.available ? place : t("routine.settings.resultDestination.unavailable", { place });
  };
  const failed = () => props.options.filter((connection) => connection.placesFailed);
  const selected = () => (props.value ? placeKey(props.value) : NONE);

  return (
    <div class="settings-field">
      <span id="agent-routine-result-destination-label">{t("routine.settings.resultDestination")}</span>
      <Select<string>
        options={[NONE, ...entries().map((candidate) => candidate.key)]}
        value={selected()}
        onChange={(key) => {
          if ((key ?? NONE) === selected()) return;
          props.onChange(key ? (entry(key)?.choice ?? null) : null);
        }}
        itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
      >
        <SelectTrigger aria-labelledby="agent-routine-result-destination-label">
          <SelectValue<string>>{(state) => label(state.selectedOption())}</SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
      <For each={failed()}>
        {(connection) => (
          <Text variant="caption" tone="muted">
            {t("routine.settings.resultDestination.placesFailed", { connection: connection.connectionName })}
          </Text>
        )}
      </For>
    </div>
  );
}
