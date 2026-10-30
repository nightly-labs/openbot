import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Delete from "lucide-react-native/icons/delete";
import type { ReactNode } from "react";
import { View } from "react-native";
import { PIN_LENGTH } from "@/features/app-lock/model/app-lock-storage";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
] as const;
const POSITIONS = Array.from({ length: PIN_LENGTH }, (_, index) => index);

export function PinDots({ count }: { count: number }) {
  const { t } = useText();
  return (
    <View
      accessible
      accessibilityLabel={t("mobile.appLock.lock.progress", { count })}
      className="flex-row justify-center gap-5"
    >
      {POSITIONS.map((position) => (
        <View
          key={position}
          className={`size-3.5 rounded-full border border-foreground ${position < count ? "bg-foreground" : ""}`}
        />
      ))}
    </View>
  );
}

function PadKey({
  label,
  children,
  disabled,
  onPress,
}: {
  label: string;
  children: ReactNode;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      variant="ghost"
      isIconOnly
      isDisabled={disabled}
      accessibilityLabel={label}
      className="size-20 rounded-full"
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      {children}
    </Button>
  );
}

/** A number pad. `leading` takes the empty place left of zero, such as a Face ID key. */
export function PinPad({
  disabled,
  canDelete,
  leading,
  onDigit,
  onDelete,
}: {
  disabled: boolean;
  canDelete: boolean;
  leading?: ReactNode;
  onDigit: (digit: string) => void;
  onDelete: () => void;
}) {
  const { t } = useText();
  const foreground = useThemeColor("foreground");
  const digit = (value: string) => (
    <PadKey key={value} label={value} disabled={disabled} onPress={() => onDigit(value)}>
      <Typography type="h3">{value}</Typography>
    </PadKey>
  );
  return (
    <View className="items-center gap-3">
      {ROWS.map((row) => (
        <View key={row[0]} className="flex-row gap-6">
          {row.map(digit)}
        </View>
      ))}
      <View className="flex-row gap-6">
        <View className="size-20 items-center justify-center">{leading}</View>
        {digit("0")}
        <View className="size-20 items-center justify-center">
          {canDelete ? (
            <PadKey label={t("mobile.appLock.lock.delete")} disabled={disabled} onPress={onDelete}>
              <Delete size={26} color={foreground} strokeWidth={1.75} />
            </PadKey>
          ) : null}
        </View>
      </View>
    </View>
  );
}
