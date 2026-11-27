import { Button, Typography } from "heroui-native";
import { View } from "react-native";
import { haptics } from "@/shared/lib/haptics";

export function RemoteContentHold({
  message,
  action,
  color,
  onPress,
}: {
  message: string;
  action: string;
  color?: string;
  onPress: () => void;
}) {
  return (
    <View className="items-start gap-2 px-3 py-2.5">
      <Typography.Paragraph type="body-sm" className="text-muted" style={color ? { color } : undefined}>
        {message}
      </Typography.Paragraph>
      <Button
        variant="secondary"
        size="sm"
        onPress={() => {
          void haptics.selection();
          onPress();
        }}
      >
        <Button.Label>{action}</Button.Label>
      </Button>
    </View>
  );
}
