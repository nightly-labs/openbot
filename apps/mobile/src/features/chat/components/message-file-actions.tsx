import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import Copy from "lucide-react-native/icons/copy";
import Download from "lucide-react-native/icons/download";
import Share from "lucide-react-native/icons/share";
import type { ReactNode } from "react";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { CoveringMenuView } from "@/shared/components/covering-menu-view";
import type { MenuAction } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { copiesToClipboard, savesToPhotos, useAttachmentFiles } from "./attachment-preview";

const ICON_SIZE = 22;
const ALL = "all";
const ALL_PHOTOS = "all-photos";

/**
 * Copy, Share and Save for the files of one message, in the message sheet. A message with one file
 * acts on it at once. A message with more files opens a menu that names each file, so the reader
 * sees which file an action takes. Each action runs when the sheet has closed.
 */
export function MessageFileActions({
  serverId,
  attachments,
  iconColor,
  afterSheet,
}: {
  serverId: string;
  attachments: readonly AttachmentSummary[];
  iconColor: string;
  /** Closes the sheet and runs the action after it, so a share sheet or a picker shows over the chat. */
  afterSheet: (action: () => void) => void;
}) {
  const { t } = useText();
  const files = useAttachmentFiles(serverId, attachments);
  const single = attachments.length === 1 ? attachments[0] : undefined;
  const copyable = attachments.filter(copiesToClipboard);
  const photos = attachments.filter(savesToPhotos);
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const succeed = (done: boolean) => {
    if (done) void haptics.notification("success");
  };
  const copy = (attachment: AttachmentSummary) => afterSheet(() => void files.copyFile(attachment).then(succeed));
  const save = (attachment: AttachmentSummary) =>
    afterSheet(
      () =>
        void (savesToPhotos(attachment) ? files.saveAllToPhotos([attachment]) : files.saveToFiles([attachment])).then(
          succeed,
        ),
    );
  /** One menu entry for each file, under a header. */
  const eachFile = (image: (attachment: AttachmentSummary) => MenuAction["image"]): MenuAction => ({
    title: t("mobile.chat.message.oneFile"),
    displayInline: true,
    subactions: attachments.map((attachment) => ({
      id: attachment.id,
      title: attachment.name,
      image: image(attachment),
    })),
  });

  return (
    <SettingsSection>
      {single && copiesToClipboard(single) ? (
        <Row icon={<Copy size={ICON_SIZE} color={iconColor} />} onPress={() => copy(single)}>
          {savesToPhotos(single) ? t("mobile.chat.message.copyImage") : t("mobile.chat.message.copyText")}
        </Row>
      ) : !single && copyable.length > 0 ? (
        <MenuRow
          icon={<Copy size={ICON_SIZE} color={iconColor} />}
          label={t("mobile.chat.message.copyFile")}
          actions={copyable.map((attachment) => ({
            id: attachment.id,
            title: attachment.name,
            image: savesToPhotos(attachment) ? "photo" : "doc.text",
          }))}
          onAction={(id) => {
            const attachment = byId.get(id);
            if (attachment) copy(attachment);
          }}
        />
      ) : null}

      {single ? (
        <Row icon={<Share size={ICON_SIZE} color={iconColor} />} onPress={() => afterSheet(files.shareAll)}>
          {t("mobile.chat.message.share")}
        </Row>
      ) : (
        <MenuRow
          icon={<Share size={ICON_SIZE} color={iconColor} />}
          label={t("mobile.chat.message.share")}
          actions={[
            { id: ALL, title: t("mobile.chat.message.shareAll"), image: "square.and.arrow.up.on.square" },
            eachFile(() => "square.and.arrow.up"),
          ]}
          onAction={(id) => {
            if (id === ALL) return afterSheet(files.shareAll);
            const attachment = byId.get(id);
            if (attachment) afterSheet(() => files.shareFile(attachment));
          }}
        />
      )}

      {single ? (
        <Row icon={<Download size={ICON_SIZE} color={iconColor} />} onPress={() => save(single)}>
          {savesToPhotos(single) ? t("mobile.chat.message.saveToPhotos") : t("mobile.chat.message.saveToFiles")}
        </Row>
      ) : (
        <MenuRow
          icon={<Download size={ICON_SIZE} color={iconColor} />}
          label={t("mobile.chat.message.save")}
          actions={[
            { id: ALL, title: t("mobile.chat.message.saveAllToFiles"), image: "folder" },
            ...(photos.length > 0
              ? [
                  {
                    id: ALL_PHOTOS,
                    title: t("mobile.chat.message.saveImagesToPhotos", { count: photos.length }),
                    image: "photo.on.rectangle" as const,
                  },
                ]
              : []),
            // An image goes to Photos and another file to Files, as the icon shows.
            eachFile((attachment) => (savesToPhotos(attachment) ? "photo" : "folder")),
          ]}
          onAction={(id) => {
            if (id === ALL) return afterSheet(() => void files.saveToFiles().then(succeed));
            if (id === ALL_PHOTOS) return afterSheet(() => void files.saveAllToPhotos(photos).then(succeed));
            const attachment = byId.get(id);
            if (attachment) save(attachment);
          }}
        />
      )}
    </SettingsSection>
  );
}

function Row({ icon, onPress, children }: { icon: ReactNode; onPress: () => void; children: string }) {
  return (
    <SettingsRow leading={icon} disclosure={false} onPress={onPress}>
      <Typography>{children}</Typography>
    </SettingsRow>
  );
}

/** A row that opens a native menu, as Send to channel does. */
function MenuRow({
  icon,
  label,
  actions,
  onAction,
}: {
  icon: ReactNode;
  label: string;
  actions: MenuAction[];
  onAction: (id: string) => void;
}) {
  return (
    <CoveringMenuView
      accessibilityLabel={label}
      title={label}
      actions={actions}
      onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}
    >
      <SettingsRow leading={icon} disclosure={false}>
        <Typography>{label}</Typography>
      </SettingsRow>
    </CoveringMenuView>
  );
}
