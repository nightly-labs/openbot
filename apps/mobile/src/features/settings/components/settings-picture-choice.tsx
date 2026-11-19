import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import { haptics } from "@/shared/lib/haptics";

export interface SettingsPictureOption<T> {
  value: T;
  label: string;
  picture: (play: number) => ReactNode;
}

export function SettingsPictureChoice<T extends string | boolean>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly SettingsPictureOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const [play, setPlay] = useState<{ value: T; count: number } | null>(null);
  const checkColor = String(useThemeColor("accent-foreground"));
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} className="flex-row gap-3 px-4 pt-4 pb-3">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked, disabled }}
            disabled={disabled}
            className="flex-1 items-center gap-2"
            style={{ opacity: disabled ? 0.45 : 1 }}
            onPress={() => {
              void haptics.selection();
              setPlay((current) => ({ value: option.value, count: (current?.count ?? 0) + 1 }));
              if (!checked) onChange(option.value);
            }}
          >
            {({ pressed }) => (
              <>
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  className="w-full overflow-hidden rounded-grouped border border-grouped-border bg-sheet"
                  style={{ aspectRatio: 1.3, transform: [{ scale: pressed && !disabled ? 0.97 : 1 }] }}
                >
                  {option.picture(play?.value === option.value ? play.count : 0)}
                </View>
                <Typography type="body-sm" numberOfLines={2} className="text-center">
                  {option.label}
                </Typography>
                {checked ? (
                  <View className="size-[22px] items-center justify-center rounded-full bg-accent">
                    <Check size={14} strokeWidth={3} color={checkColor} />
                  </View>
                ) : (
                  <View className="size-[22px] rounded-full border-[1.5px] border-grouped-secondary" />
                )}
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
