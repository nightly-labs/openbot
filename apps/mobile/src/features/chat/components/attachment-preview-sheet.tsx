import { Image } from "expo-image";
import { Button, Typography } from "heroui-native";
import { useRef } from "react";
import { Modal, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface AttachmentPreview {
  name: string;
  /** The image to show. A file that is not an image shows its type and size instead. */
  uri: string | null;
  type: string;
  size: string;
}

export interface AttachmentPreviewAction {
  label: string;
  onPress: () => void;
  variant?: "secondary" | "danger-soft";
  disabled?: boolean;
}

/**
 * One attachment at full size, with what can be done to it. iOS presents a native page sheet
 * the user swipes away, and Android closes it with the system back action, so neither needs a
 * separate close button. An action closes the sheet first and runs once it is gone: iOS refuses
 * to present a picker or the share sheet from a sheet that is still leaving.
 */
export function AttachmentPreviewSheet({
  preview,
  actions,
  onClose,
}: {
  preview: AttachmentPreview | null;
  actions: AttachmentPreviewAction[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const afterClose = useRef<(() => void) | null>(null);
  // The sheet slides away after `preview` clears, so it keeps drawing what it showed until then.
  const last = useRef(preview);
  if (preview) last.current = preview;
  const shown = preview ?? last.current;
  function run(action: AttachmentPreviewAction) {
    if (Platform.OS === "ios") {
      afterClose.current = action.onPress;
      onClose();
    } else {
      onClose();
      action.onPress();
    }
  }
  return (
    <Modal
      visible={preview !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={() => {
        const action = afterClose.current;
        afterClose.current = null;
        action?.();
      }}
    >
      {shown ? (
        <View className="flex-1 bg-background" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          <View className="gap-0.5 px-5 pt-5 pb-3">
            <Typography.Paragraph numberOfLines={2} className="font-semibold text-foreground">
              {shown.name}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-sm" className="text-muted">
              {`${shown.type} · ${shown.size}`}
            </Typography.Paragraph>
          </View>
          {shown.uri ? (
            <Image
              source={shown.uri}
              contentFit="contain"
              accessibilityLabel={shown.name}
              style={{ flex: 1 }}
              transition={0}
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <View className="size-24 items-center justify-center rounded-3xl bg-success/15">
                <Typography.Heading type="h4" className="text-success-text">
                  {shown.type}
                </Typography.Heading>
              </View>
            </View>
          )}
          <View className="flex-row gap-3 px-5 pt-4">
            {actions.map((action) => (
              <Button
                key={action.label}
                className="flex-1"
                variant={action.variant ?? "secondary"}
                isDisabled={action.disabled}
                onPress={() => run(action)}
              >
                <Button.Label>{action.label}</Button.Label>
              </Button>
            ))}
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
