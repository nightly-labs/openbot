import { useText } from "@openbot/ui/text";
import { createSignal, For } from "solid-js";
import { type StorageGroup, type StorageGroupTotal, sharePercentLabel } from "./files-view";

/**
 * One stacked bar of where the space goes, with the legend as the readable data. The bar is an
 * image with a text summary; the legend rows carry the names, sizes and shares, so identity is
 * never colour alone. Pointing at a segment or a legend row highlights the pair.
 */
export function StorageUsageBar(props: { groups: readonly StorageGroupTotal[]; label: string }) {
  const { format } = useText();
  const [active, setActive] = createSignal<StorageGroup | null>(null);
  const summary = () =>
    `${props.label}: ${props.groups.map((entry) => `${entry.label} ${format.fileSize(entry.bytes)}`).join(", ")}`;
  const activeState = (group: StorageGroup) => (active() === group ? "true" : undefined);

  return (
    <div class="storage-usage" data-hovering={active() ? "true" : undefined}>
      <div class="storage-usage-bar" role="img" aria-label={summary()}>
        <For each={props.groups}>
          {(entry) => (
            <span
              class="storage-usage-segment"
              data-group={entry.group}
              data-active={activeState(entry.group)}
              style={{ "flex-grow": String(entry.bytes) }}
              onPointerEnter={() => setActive(entry.group)}
              onPointerLeave={() => setActive(null)}
            />
          )}
        </For>
      </div>
      <ul class="storage-usage-legend" aria-label={props.label}>
        <For each={props.groups}>
          {(entry) => (
            <li
              class="storage-usage-legend-row"
              data-group={entry.group}
              data-active={activeState(entry.group)}
              onPointerEnter={() => setActive(entry.group)}
              onPointerLeave={() => setActive(null)}
            >
              <span class="storage-usage-swatch" aria-hidden="true" />
              <span class="storage-usage-legend-label">{entry.label}</span>
              <span class="storage-usage-legend-value">{format.fileSize(entry.bytes)}</span>
              <span class="storage-usage-legend-percent">{sharePercentLabel(entry.percent, format)}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
