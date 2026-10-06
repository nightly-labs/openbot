import { Tabs } from "heroui-native";
import { haptics } from "@/shared/lib/haptics";

/**
 * A full-width segmented choice of a usage report. The native segmented control is a capsule
 * that cannot take the 16 pt group corner, so this uses HeroUI tabs with the group radius.
 */
export function UsageSegments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (!option || option.value === value) return;
        void haptics.selection();
        onChange(option.value);
      }}
    >
      <Tabs.List className="self-stretch rounded-grouped">
        {/* The group corner less the 3 pt list padding, so the corners stay concentric. */}
        <Tabs.Indicator className="rounded-[13px]" />
        {options.map((option) => (
          <Tabs.Trigger key={option.value} value={option.value} className="flex-1 px-1">
            <Tabs.Label numberOfLines={1} className="text-sm">
              {option.label}
            </Tabs.Label>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs>
  );
}
