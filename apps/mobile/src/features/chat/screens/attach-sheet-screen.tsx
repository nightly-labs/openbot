import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Camera from "lucide-react-native/icons/camera";
import Paperclip from "lucide-react-native/icons/paperclip";
import Sparkles from "lucide-react-native/icons/sparkles";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { useAppActive } from "@/shared/lib/use-app-active";
import { ChatCameraContent } from "../components/chat-camera-panel";
import { ChatRecentPhotosStrip } from "../components/chat-recent-photos-strip";
import { ComposerContextRing } from "../components/composer-context-ring";
import { type RecentPhoto, recentPhotoUri, useRecentPhotos } from "../components/use-recent-photos";
import { releaseAttachSheet, useAttachSheetRequest } from "../model/attach-sheet";

const ICON_SIZE = 22;

export function AttachSheetScreen() {
  const { t, format } = useText();
  const request = useAttachSheetRequest();
  const [foreground] = useThemeColor(["foreground"]);
  const photos = useRecentPhotos();
  const appActive = useAppActive();
  const [camera, setCamera] = useState(false);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      releaseAttachSheet(request);
      afterClose.current?.();
      afterClose.current = undefined;
    },
    [request],
  );

  if (!request) return null;
  const { attachments, context, onSendPhoto, onUseSkill } = request;
  const icon = String(foreground);
  const afterSheet = (action: () => void) => {
    afterClose.current = action;
    router.back();
  };
  const sendRecent = (photo: RecentPhoto) =>
    afterSheet(() => {
      void attachments
        .preparePhoto(() => recentPhotoUri(photo.id), photo.name)
        .then((item) => {
          if (item) onSendPhoto(item);
        });
    });
  const openCamera = async () => {
    if (await attachments.requestCamera()) setCamera(true);
  };

  if (camera)
    return (
      <View className="flex-1 bg-sheet p-4 pb-safe-offset-4 pt-7">
        <View className="flex-1 overflow-hidden rounded-grouped bg-black">
          {appActive ? (
            <ChatCameraContent
              onBusyChange={() => {}}
              onCancel={() => setCamera(false)}
              onCaptured={(uri) => afterSheet(() => void attachments.addPhoto(uri))}
            />
          ) : null}
        </View>
      </View>
    );

  return (
    <SheetScrollView scrollEdgeEffect={false} contentContainerClassName="gap-5 px-4 pb-safe-offset-4 pt-5">
      <View className="h-11 flex-row items-center">
        <View className="flex-1" />
        <Typography.Paragraph
          accessibilityRole="header"
          className={isAndroid ? "font-normal" : "font-semibold"}
          numberOfLines={1}
          style={isAndroid ? typeScale.barTitleAndroid : typeScale.barTitle}
        >
          {t("mobile.chat.attachment.sheetTitle")}
        </Typography.Paragraph>
        <View className="flex-1 items-end">
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPressIn={() => void haptics.selection()}
            onPress={() => afterSheet(() => void attachments.choosePhotos())}
          >
            <Typography.Paragraph>{t("mobile.chat.attachment.photos")}</Typography.Paragraph>
          </Pressable>
        </View>
      </View>
      {photos.length > 0 ? (
        <View className="-mx-4">
          <ChatRecentPhotosStrip photos={photos} onPick={sendRecent} />
        </View>
      ) : null}
      <SettingsSection>
        <SettingsRow
          leading={<Camera size={ICON_SIZE} color={icon} />}
          disclosure={false}
          onPress={() => void openCamera()}
        >
          <Typography>{t("mobile.chat.attachment.camera")}</Typography>
        </SettingsRow>
        <SettingsRow
          leading={<Paperclip size={ICON_SIZE} color={icon} />}
          disclosure={false}
          onPress={() => afterSheet(() => void attachments.chooseFiles())}
        >
          <Typography>{t("mobile.chat.attachment.files")}</Typography>
        </SettingsRow>
        {onUseSkill ? (
          <SettingsRow
            leading={<Sparkles size={ICON_SIZE} color={icon} />}
            disclosure={false}
            onPress={() => afterSheet(onUseSkill)}
          >
            <Typography>{t("mobile.chat.attachment.useSkill")}</Typography>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {context ? (
        <SettingsSection>
          <SettingsRow
            leading={<ComposerContextRing meter={context} />}
            accessibilityLabel={context.label}
            value={context.compacting ? undefined : format.percent(context.share, { maximumFractionDigits: 0 })}
            onPress={() => afterSheet(context.onPress)}
          >
            <Typography>{t("mobile.chat.context.title")}</Typography>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SheetScrollView>
  );
}
