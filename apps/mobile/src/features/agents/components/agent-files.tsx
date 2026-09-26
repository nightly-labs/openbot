import type { StorageCategory, StorageUsage, StoredFileRow } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable } from "react-native";
import { AttachmentThumbnail, useAttachmentFile } from "@/features/chat/components/attachment-preview";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { currentText, useText } from "@/shared/lib/text";

const CATEGORIES: { category: StorageCategory; label: MobileTextKey }[] = [
  { category: "workspaces", label: "mobile.agent.files.category.workspaces" },
  { category: "attachments", label: "mobile.agent.files.category.attachments" },
  { category: "generated", label: "mobile.agent.files.category.generated" },
  { category: "chats", label: "mobile.agent.files.category.chats" },
];
const CHAT_ROWS = 4;

/** Agent info > Files: what this agent keeps on the host, like the desktop agent settings. */
export function AgentFiles({
  agent,
  usage,
  canDelete,
  onChanged,
}: {
  agent: MobileAgent;
  usage: StorageUsage;
  /** Owners and admins delete files. A member only reads. */
  canDelete: boolean;
  /** Measures again after a deletion, whether it succeeded or not. */
  onChanged: () => void;
}) {
  const bytes = (category: StorageCategory) => usage.breakdown.find((entry) => entry.category === category)?.bytes ?? 0;
  const total = usage.breakdown.reduce((sum, entry) => sum + entry.bytes, 0);
  const { t, format } = useText();
  const chats = [...usage.conversations].sort((left, right) => right.bytes - left.bytes).slice(0, CHAT_ROWS);
  return (
    <>
      <SettingsSection title={t("mobile.agent.files.total", { name: agent.name, size: format.fileSize(total) })}>
        {CATEGORIES.map(({ category, label }) => (
          <SettingsRow key={category} trailing={<Size bytes={bytes(category)} />}>
            <Typography.Paragraph>{t(label)}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      {chats.length ? (
        <SettingsSection title={t("mobile.agent.files.chatsBySize")}>
          {chats.map((chat) => (
            <SettingsRow
              key={chat.id}
              supportingText={`${t("mobile.agent.files.fileCount", { count: chat.fileCount })} · ${t("mobile.agent.files.messageCount", { count: chat.messageCount })}`}
              trailing={<Size bytes={chat.bytes} />}
            >
              <Typography.Paragraph numberOfLines={1}>{chat.title}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      <SettingsSection title={t("mobile.agent.files.files")}>
        {usage.files.map((file) => (
          <StoredFile
            key={file.id}
            agent={agent}
            file={file}
            canDelete={canDelete && file.deletable}
            onChanged={onChanged}
          />
        ))}
        {!usage.files.length ? (
          <SettingsRow>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.agent.files.empty", { name: agent.name })}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {usage.truncated ? <SettingsNote>{t("mobile.agent.files.truncated")}</SettingsNote> : null}
    </>
  );
}

function Size({ bytes }: { bytes: number }) {
  const { format } = useText();
  return <Typography className="text-grouped-secondary">{format.fileSize(bytes)}</Typography>;
}

/** A stored file opens in the share sheet, like a queued file. */
function StoredFile({
  agent,
  file,
  canDelete,
  onChanged,
}: {
  agent: MobileAgent;
  file: StoredFileRow;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const { t, format } = useText();
  const { deleteStoredFile } = useMobileWorkspace();
  const danger = useThemeColor("danger");
  const [deleting, setDeleting] = useState(false);
  const image = file.kind === "image";
  const missing = file.status === "missing";
  const attachment = useAttachmentFile(agent.serverId, file, image && !missing);
  const details = [
    format.fileSize(file.size),
    file.source === "generated" ? t("mobile.agent.files.fromAgent") : null,
    file.conversation?.title ?? null,
    missing ? t("mobile.agent.files.missing") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function confirmDelete() {
    Alert.alert(
      t(missing ? "mobile.agent.files.removeTitle" : "mobile.agent.files.deleteTitle"),
      missing
        ? t("mobile.agent.files.removeBody", { name: file.name })
        : t("mobile.agent.files.deleteBody", { name: file.name }),
      [
        { text: t("mobile.agent.files.keep"), style: "cancel" },
        {
          text: t(missing ? "common.remove" : "common.delete"),
          style: "destructive",
          onPress: () => {
            setDeleting(true);
            deleteStoredFile(file.id, agent.serverId)
              .catch((cause: unknown) => {
                const text = currentText();
                Alert.alert(
                  text.t("mobile.agent.files.deleteFailed"),
                  text.errorMessage(cause, text.t("mobile.agent.files.deleteFailedBody")),
                );
              })
              .finally(() => {
                setDeleting(false);
                onChanged();
              });
          },
        },
      ],
    );
  }

  return (
    <SettingsRow
      disclosure={false}
      disabled={deleting}
      leading={<AttachmentThumbnail name={file.name} uri={image ? attachment.uri : null} />}
      supportingText={attachment.busy ? t("mobile.agent.files.downloading") : details}
      trailing={
        canDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(missing ? "mobile.agent.files.removeNamed" : "mobile.agent.files.deleteNamed", {
              name: file.name,
            })}
            accessibilityState={{ disabled: deleting }}
            disabled={deleting}
            hitSlop={8}
            onPress={confirmDelete}
          >
            <Trash2 size={18} color={String(danger)} />
          </Pressable>
        ) : undefined
      }
      onPress={missing ? undefined : attachment.share}
    >
      <Typography numberOfLines={1}>{file.name}</Typography>
    </SettingsRow>
  );
}
