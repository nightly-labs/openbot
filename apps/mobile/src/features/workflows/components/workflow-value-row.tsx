import { Typography } from "heroui-native";
import { SettingsRow } from "@/features/settings/components/settings-content";

export function ValueRow({
  label,
  value,
  disabled,
  onPress,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <SettingsRow
      disabled={disabled}
      onPress={onPress}
      trailing={
        <Typography.Paragraph className="text-grouped-secondary" numberOfLines={1}>
          {value}
        </Typography.Paragraph>
      }
    >
      <Typography.Paragraph>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}
