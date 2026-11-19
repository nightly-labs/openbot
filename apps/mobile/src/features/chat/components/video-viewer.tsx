import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import Download from "lucide-react-native/icons/download";
import Share from "lucide-react-native/icons/share";
import X from "lucide-react-native/icons/x";
import { useState } from "react";
import { Modal, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { ScopedTheme } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";
import { ChatGlassIconButton } from "./chat-glass-icon-button";

const HEADER_HEIGHT = 8 + 48 + 8;

interface VideoViewerProps {
  uri: string;
  name: string;
  busy: boolean;
  onShare: () => void;
  onSave: () => Promise<boolean>;
  onDismissed: () => void;
}

export function VideoViewer(props: VideoViewerProps) {
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={props.onDismissed}
    >
      <SafeAreaProvider>
        <ScopedTheme theme="dark">
          <VideoViewerContent {...props} />
        </ScopedTheme>
      </SafeAreaProvider>
    </Modal>
  );
}

function VideoViewerContent({ uri, name, busy, onShare, onSave, onDismissed }: VideoViewerProps) {
  const insets = useSafeAreaInsets();
  const text = useText();
  const liquidGlassAvailable = useLiquidGlass();
  const [foreground, fallbackBackground] = useThemeColor(["foreground", "default"]);
  const [saved, setSaved] = useState(false);
  const player = useVideoPlayer(uri, (player) => {
    player.play();
  });

  function close() {
    player.pause();
    onDismissed();
  }

  return (
    <View className="flex-1 bg-black" accessibilityViewIsModal>
      <StatusBar style="light" />
      <View
        className="flex-row items-center justify-between pb-2"
        style={{ paddingTop: insets.top + 8, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
        accessibilityActions={[{ name: "escape" }]}
        onAccessibilityEscape={close}
      >
        <ChatGlassIconButton
          accessibilityLabel={text.t("common.close")}
          colorScheme="dark"
          fallbackBackground={fallbackBackground}
          liquidGlassAvailable={liquidGlassAvailable}
          onPress={() => {
            void haptics.impact("soft");
            close();
          }}
        >
          <X size={22} color={String(foreground)} />
        </ChatGlassIconButton>
        <View className="flex-row gap-2">
          <ChatGlassIconButton
            accessibilityLabel={text.t("mobile.chat.video.share", { name })}
            disabled={busy}
            colorScheme="dark"
            fallbackBackground={fallbackBackground}
            liquidGlassAvailable={liquidGlassAvailable}
            onPress={() => {
              void haptics.impact("soft");
              player.pause();
              onShare();
            }}
          >
            <Share size={20} color={String(foreground)} />
          </ChatGlassIconButton>
          <ChatGlassIconButton
            accessibilityLabel={
              saved ? text.t("mobile.chat.imageViewer.saved") : text.t("mobile.chat.video.save", { name })
            }
            disabled={busy || saved}
            colorScheme="dark"
            fallbackBackground={fallbackBackground}
            liquidGlassAvailable={liquidGlassAvailable}
            onPress={() =>
              void onSave().then((done) => {
                if (!done) return;
                void haptics.notification("success");
                setSaved(true);
              })
            }
          >
            {saved ? <Check size={21} color={String(foreground)} /> : <Download size={20} color={String(foreground)} />}
          </ChatGlassIconButton>
        </View>
      </View>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        surfaceType="textureView"
        accessibilityLabel={name}
        style={{ flex: 1, marginBottom: Math.max(insets.bottom, insets.top + HEADER_HEIGHT) }}
      />
    </View>
  );
}
