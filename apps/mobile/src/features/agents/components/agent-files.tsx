import type { StorageCategory, StorageUsage, StoredFileRow } from "@openbot/contracts/ipc";
import { userErrorMessage as errorMessage } from "@openbot/user-errors";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable } from "react-native";
import { AttachmentThumbnail, formatFileSize, useAttachmentFile } from "@/features/chat/components/attachment-preview";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

const CATEGORIES: { category: StorageCategory; label: string }[] = [
  { category: "workspaces", label: "Workspace" },
  { category: "attachments", label: "Attachments" },
  { category: "generated", label: "Files from agents" },
  { category: "chats", label: "Chat history" },
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
  const chats = [...usage.conversations].sort((left, right) => right.bytes - left.bytes).slice(0, CHAT_ROWS);
  return (
    <>
      <SettingsSection title={`${agent.name} uses ${formatFileSize(total)}`}>
        {CATEGORIES.map(({ category, label }) => (
          <SettingsRow key={category} trailing={<Size bytes={bytes(category)} />}>
            <Typography.Paragraph>{label}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      {chats.length ? (
        <SettingsSection title="Chats by size">
          {chats.map((chat) => (
            <SettingsRow
              key={chat.id}
              supportingText={`${fileCountLabel(chat.fileCount)} · ${chat.messageCount} ${chat.messageCount === 1 ? "message" : "messages"}`}
              trailing={<Size bytes={chat.bytes} />}
            >
              <Typography.Paragraph numberOfLines={1}>{chat.title}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      <SettingsSection title="Files">
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
              Files you send to {agent.name} and files it makes show here.
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {usage.truncated ? <SettingsNote>The host shows only the largest files.</SettingsNote> : null}
    </>
  );
}

function Size({ bytes }: { bytes: number }) {
  return <Typography className="text-grouped-secondary">{formatFileSize(bytes)}</Typography>;
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
  const { deleteStoredFile } = useMobileWorkspace();
  const danger = useThemeColor("danger");
  const [deleting, setDeleting] = useState(false);
  const image = file.kind === "image";
  const missing = file.status === "missing";
  const attachment = useAttachmentFile(agent.serverId, file, image && !missing);
  const details = [
    formatFileSize(file.size),
    file.source === "generated" ? "From agent" : null,
    file.conversation?.title ?? null,
    missing ? "Missing" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function confirmDelete() {
    Alert.alert(
      missing ? "Remove this file?" : "Delete this file?",
      missing
        ? `“${file.name}” is removed from the list. The message that sent it stays in the chat.`
        : `“${file.name}” is deleted from the disk. The messages that show it stay in the chat without the file.`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: missing ? "Remove" : "Delete",
          style: "destructive",
          onPress: () => {
            setDeleting(true);
            deleteStoredFile(file.id, agent.serverId)
              .catch((cause: unknown) =>
                Alert.alert("Could not delete file", errorMessage(cause, "OpenBot could not delete this file.")),
              )
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
      supportingText={attachment.busy ? "Downloading…" : details}
      trailing={
        canDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${missing ? "Remove" : "Delete"} ${file.name}`}
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

function fileCountLabel(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}
