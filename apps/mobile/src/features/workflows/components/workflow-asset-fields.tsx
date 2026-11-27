import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import {
  type StoredFileRow,
  WORKFLOW_ASSET_TYPES,
  WORKFLOW_PICTURE_TYPES,
  type WorkflowNode,
} from "@openbot/contracts/ipc";
import { TEAM_PROTOCOL_V2_MAX_FILE_BYTES } from "@openbot/contracts/team-protocol/v2";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { useQueryClient } from "@tanstack/react-query";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useMemo, useState } from "react";
import { useCSSVariable } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { AttachmentThumbnail, useAttachmentFile } from "@/features/chat/components/attachment-preview";
import { fileLimitText } from "@/features/chat/model/large-files";
import { smallerPhoto } from "@/features/chat/model/smaller-photo";
import { useServerStorage } from "@/features/servers/model/use-server-storage";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useWorkflowAssetsSupported } from "@/features/workflows/model/use-workflows";
import { useWorkflowDraft, type WorkflowDraft } from "@/features/workflows/model/workflow-draft";
import { fieldText } from "@/features/workflows/model/workflow-node-fields";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { readFileBase64 } from "@/shared/lib/read-file-base64";
import { useText } from "@/shared/lib/text";

const PAGE_SIZE = 12;
const THUMBNAIL_SIZE = 40;

function workflowFiles(files: readonly StoredFileRow[] | undefined, types: ReadonlySet<string>): StoredFileRow[] {
  return (files ?? [])
    .filter((file) => file.status === "available" && types.has(file.mimeType))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

const PICKED_EXTENSION: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function photoName(asset: ImagePicker.ImagePickerAsset): string {
  const fileExtension = asset.uri.split(".").at(-1)?.toLowerCase() ?? "jpg";
  const extension = (asset.mimeType ? PICKED_EXTENSION[asset.mimeType] : undefined) ?? fileExtension;
  const base = asset.fileName?.trim() ? asset.fileName.replace(/[/\\]/gu, "_") : "photo";
  return `${base.replace(/\.[^.]*$/u, "")}.${extension}`;
}

function PictureThumbnail({ serverId, file }: { serverId: string; file: StoredFileRow }) {
  const { uri } = useAttachmentFile(serverId, file, true);
  return <AttachmentThumbnail name={file.name} uri={uri} size={THUMBNAIL_SIZE} />;
}

function usePictureUpload(serverId: string, onKept: (fileId: string, name: string) => void) {
  const text = useText();
  const { t, errorMessage } = text;
  const { uploadAttachment, discardAttachment, keepWorkflowPicture } = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function readPicture(uri: string, name: string): Promise<RemoteFileUpload> {
    const mimeType = attachmentMimeTypeForName(name);
    if (!WORKFLOW_PICTURE_TYPES.has(mimeType)) throw new Error(t("mobile.workflow.asset.type"));
    const file = new File(uri);
    const size = file.size;
    if (size === null) throw new Error(t("mobile.shared.photo.openFailed"));
    if (size > TEAM_PROTOCOL_V2_MAX_FILE_BYTES)
      throw new Error(
        t("mobile.workflow.asset.tooLarge", { limit: fileLimitText(text, TEAM_PROTOCOL_V2_MAX_FILE_BYTES) }),
      );
    if (size > MOBILE_ATTACHMENT_BYTES) return { name, mimeType, base64: "", file: { ref: uri, size } };
    return { name, mimeType, base64: await readFileBase64(file) };
  }

  async function upload() {
    if (uploading) return;
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) return;
      setUploading(true);
      const photo = await smallerPhoto(asset.uri, photoName(asset));
      const input = await readPicture(photo.uri, photo.name);
      const draft = await uploadAttachment("", input, serverId);
      const kept = await keepWorkflowPicture(draft.id, serverId).catch(async (cause: unknown) => {
        await discardAttachment("", draft.id, serverId).catch(() => undefined);
        throw cause;
      });
      onKept(kept.fileId, photo.name);
      void haptics.notification("success");
      await queryClient.invalidateQueries({ queryKey: queryKeys.serverStorage(queryScope, serverId) });
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.workflow.asset.uploadFailed")));
    } finally {
      setUploading(false);
    }
  }

  return { uploading, error, upload };
}

export function AssetFields({ node, draft }: { node: WorkflowNode; draft: WorkflowDraft }) {
  const { t } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const setFields = useWorkflowDraft((state) => state.setFields);
  const supported = useWorkflowAssetsSupported(draft.serverId);
  const { available, query } = useServerStorage(draft.serverId);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const editable = draft.mode !== "read-only";
  const fileId = fieldText(node, "fileId");
  const fileName = fieldText(node, "file");
  const choose = (id: string, name: string) => setFields(node.id, { fileId: id, file: name, media: undefined });
  const { uploading, error, upload } = usePictureUpload(draft.serverId, choose);
  const pictures = useMemo(() => workflowFiles(query.data?.files, WORKFLOW_PICTURE_TYPES), [query.data]);
  const assets = useMemo(() => workflowFiles(query.data?.files, WORKFLOW_ASSET_TYPES), [query.data]);
  const chosen = fileId ? assets.find((file) => file.id === fileId) : undefined;
  const gone = Boolean(fileId) && !chosen && !uploading && query.isSuccess && !query.data.truncated;
  const shown = pictures.slice(0, limit);
  const listed = supported && available;

  return (
    <>
      <SettingsSection
        title={t("mobile.workflow.asset.picture")}
        footer={gone ? t("mobile.workflow.asset.gone") : t("mobile.workflow.asset.hint")}
      >
        <SettingsRow
          leading={
            chosen && WORKFLOW_PICTURE_TYPES.has(chosen.mimeType) ? (
              <PictureThumbnail serverId={draft.serverId} file={chosen} />
            ) : (
              <AttachmentThumbnail name={chosen?.name ?? fileName} uri={null} size={THUMBNAIL_SIZE} />
            )
          }
        >
          <Typography.Paragraph numberOfLines={1} className={fileId ? undefined : "text-grouped-secondary"}>
            {chosen?.name ?? (fileName || t("mobile.workflow.step.assetDefault"))}
          </Typography.Paragraph>
        </SettingsRow>
        {listed && editable ? (
          <SettingsRow
            disclosure={false}
            disabled={uploading}
            accessibilityLabel={uploading ? t("mobile.workflow.asset.uploading") : t("mobile.workflow.asset.upload")}
            onPress={() => void upload()}
          >
            <Typography.Paragraph className="text-accent-text">
              {uploading ? t("mobile.workflow.asset.uploading") : t("mobile.workflow.asset.upload")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {error ? <SettingsNote>{error}</SettingsNote> : null}
      {!listed ? (
        <SettingsNote>{t("mobile.workflow.asset.unsupported")}</SettingsNote>
      ) : query.isPending ? (
        <SettingsNote>{t("mobile.workflow.asset.loading")}</SettingsNote>
      ) : query.isError ? (
        <SettingsNote>{t("mobile.workflow.asset.loadFailed")}</SettingsNote>
      ) : pictures.length === 0 ? (
        <SettingsNote>{t("mobile.workflow.asset.empty")}</SettingsNote>
      ) : (
        <SettingsSection title={t("mobile.workflow.asset.library")}>
          {shown.map((file) => (
            <SettingsRow
              key={file.id}
              checked={file.id === fileId}
              disclosure={false}
              disabled={!editable || uploading}
              leading={<PictureThumbnail serverId={draft.serverId} file={file} />}
              trailing={file.id === fileId ? <Check size={18} color={accent} strokeWidth={2} /> : null}
              onPress={() => {
                if (file.id === fileId) return;
                void haptics.selection();
                choose(file.id, file.name);
              }}
            >
              <Typography.Paragraph numberOfLines={1}>{file.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
          {pictures.length > shown.length ? (
            <SettingsRow disclosure={false} onPress={() => setLimit((current) => current + PAGE_SIZE)}>
              <Typography.Paragraph className="text-accent-text">
                {t("mobile.workflow.asset.showMore")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      )}
    </>
  );
}
