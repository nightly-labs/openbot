import { Tabs } from "heroui-native";
import { haptics } from "@/shared/lib/haptics";

export function UsageSegments<T extends string>({
  options,
  value,
  disabled = false,
  accessibilityLabel,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  accessibilityLabel?: string;
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
      <Tabs.List className="self-stretch rounded-grouped" accessibilityLabel={accessibilityLabel}>
        <Tabs.Indicator className="rounded-[13px]" />
        {options.map((option) => (
          <Tabs.Trigger key={option.value} value={option.value} isDisabled={disabled} className="flex-1 px-1">
            <Tabs.Label numberOfLines={1} className="text-sm">
              {option.label}
            </Tabs.Label>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs>
  );
}
