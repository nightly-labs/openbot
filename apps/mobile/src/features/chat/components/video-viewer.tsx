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

interface VideoViewerProps {
  uri: string;
  name: string;
  busy: boolean;
  onShare: () => void;
  onSave: () => Promise<boolean>;
  onDismissed: () => void;
}

/**
 * A video from the chat on the whole screen. It starts at once. The platform's own controls
 * play, pause, seek on the timeline, mute and open the native full screen. The buttons above it
 * close the player, share the file and save it to Photos.
 *
 * The player is dark in both appearances: the native player draws black, so a theme background
 * around it would show as bands of another colour above and below the video.
 */
export function VideoViewer(props: VideoViewerProps) {
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={props.onDismissed}
    >
      {/* The player covers the window, and the chat can be one column of it: the insets are the
          window's, so the controls keep clear of the rail of iPhone Duo on either side. */}
      <SafeAreaProvider>
        <ScopedTheme theme="dark">
          <VideoViewerContent {...props} />
        </ScopedTheme>
      </SafeAreaProvider>
    </Modal>
  );
}

/** Inside the dark theme scope, so the theme colours it reads are the dark ones. */
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
        {/* Close at the leading edge, where the platform puts the way out of a full-screen view. */}
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
              // The share sheet covers the player, so the video waits for the user.
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
        // A texture draws inside the modal's window on Android; a surface view can draw under it.
        surfaceType="textureView"
        accessibilityLabel={name}
        style={{ flex: 1, marginBottom: insets.bottom }}
      />
    </View>
  );
}
