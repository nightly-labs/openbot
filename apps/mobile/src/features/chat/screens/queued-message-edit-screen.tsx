import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ImagePlus, Paperclip, X } from "lucide-react-native";
import { type PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { AttachmentThumbnail, localAttachmentPreview, useAttachmentFile } from "../components/attachment-preview";
import { useChatAttachments } from "../components/use-chat-attachments";
import type { ChatQueueController } from "../components/use-chat-queue";
import { useQueuedChat } from "../context/queued-messages-context";

export function QueuedMessageEditScreen() {
  const { chat, deliveryId } = useLocalSearchParams<{ chat: string; deliveryId: string }>();
  const { queue } = useQueuedChat(chat);
  const navigation = useNavigation();
  const held = queue?.edit?.delivery ?? null;
  const delivery = held?.id === deliveryId ? held : queue?.queued.find((item) => item.id === deliveryId);
  const edit = queue?.edit ?? null;

  // The field is controlled from this screen. The controller lives on the chat screen
  // behind the sheet, so its text only returns one commit later, which loses characters
  // while typing. `changeText` still runs for the durable draft.
  const [typed, setTyped] = useState<{ editId: string; text: string } | null>(null);
  const text = edit && typed?.editId === edit.editId ? typed.text : (edit?.text ?? "");
  const added = queue?.attachments.length ?? 0;
  const dirty = edit
    ? text !== edit.delivery.text || edit.keepAttachmentIds.length !== edit.delivery.attachments.length || added > 0
    : false;

  // The host hold is taken once per visit. `busy` only turns on once the controller
  // starts the request, so track it here as well and keep the failure copy until then.
  const [holding, setHolding] = useState(false);
  // Attachment reads run in the attachments section below. Save must wait for them,
  // or it sends the file list from before the new selection.
  const [attachmentsPreparing, setAttachmentsPreparing] = useState(false);
  const requested = useRef(false);
  const hold = useCallback(() => {
    if (!queue || !delivery) return;
    requested.current = true;
    setHolding(true);
    void queue.begin(delivery).finally(() => setHolding(false));
  }, [queue, delivery]);
  useEffect(() => {
    if (requested.current || !queue || !delivery || queue.confirmed) return;
    hold();
  }, [queue, delivery, hold]);

  // Leaving releases the hold, so the message cannot stay stuck on Editing. The
  // navigation runs a render later, once the guard below reads `leaving`.
  const [leaving, setLeaving] = useState(false);
  const exit = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!leaving) return;
    const go = exit.current;
    exit.current = null;
    go?.();
  }, [leaving]);
  const exitAfter = useCallback((work: Promise<unknown> | null, go: () => void) => {
    const finish = () => {
      exit.current = go;
      setLeaving(true);
    };
    if (work) void work.finally(finish);
    else finish();
  }, []);
  // The editor closes only after the host lets the message go. A failed release keeps the
  // message held, so the agent would wait for a phone that no longer shows the editor.
  const releaseThenExit = useCallback(
    (go: () => void, onFailure?: () => void) => {
      const work = queue?.cancelEdit();
      if (!work) {
        exitAfter(null, go);
        return;
      }
      void work.then((released) => {
        if (released) exitAfter(null, go);
        else onFailure?.();
      });
    },
    [queue, exitAfter],
  );
  usePreventRemove(Boolean(edit) && !leaving, ({ data }) => {
    const go = () => navigation.dispatch(data.action);
    const release = () =>
      releaseThenExit(go, () => {
        Alert.alert(
          "Still holding the message",
          "OpenBot could not release this message, so the agent keeps waiting for it. Try again after the phone reconnects.",
          [
            { text: "Keep editing", style: "cancel" },
            { text: "Leave anyway", onPress: () => exitAfter(null, go) },
          ],
        );
      });
    if (!dirty) {
      release();
      return;
    }
    Alert.alert("Discard changes?", "The queued message keeps the text the agent already has.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: release },
    ]);
  });

  if (!queue || !delivery) {
    return (
      <SettingsContent>
        <Typography.Paragraph align="center" className="text-text-secondary">
          This message is no longer queued.
        </Typography.Paragraph>
      </SettingsContent>
    );
  }

  if (queue.editUnavailable) {
    return (
      <SettingsContent>
        <Typography.Paragraph align="center" className="text-text-secondary">
          The agent already received this message, so it cannot be changed.
        </Typography.Paragraph>
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={queue.busy}
            onPress={() => exitAfter(queue.discardFinishedEdit(), () => router.back())}
          >
            <Typography>Close</Typography>
          </SettingsRow>
        </SettingsSection>
      </SettingsContent>
    );
  }

  if (!edit || !queue.confirmed) {
    const pending = holding || queue.busy;
    return (
      <SettingsContent>
        <Typography.Paragraph align="center" className="text-text-secondary">
          {pending ? "Holding the message for you…" : "OpenBot could not hold this message for editing."}
        </Typography.Paragraph>
        {queue.error ? (
          <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
            {queue.error}
          </Typography.Paragraph>
        ) : null}
        {pending ? null : (
          <SettingsSection>
            <SettingsRow disclosure={false} onPress={hold}>
              <Typography>Try again</Typography>
            </SettingsRow>
          </SettingsSection>
        )}
      </SettingsContent>
    );
  }

  const kept = edit.delivery.attachments.filter((file) => edit.keepAttachmentIds.includes(file.id));

  return (
    <SettingsContent>
      <SheetFormField
        label="Message"
        appearance="soft"
        multiline
        editable={!queue.busy && !edit.pendingSave}
        maxLength={INPUT_LIMITS.messageText}
        placeholder="Message text"
        value={text}
        onChangeText={(value) => {
          setTyped({ editId: edit.editId, text: value });
          queue.changeText(value);
        }}
      />
      <SheetSaveAction
        dirty={dirty || Boolean(edit.pendingSave)}
        canSave={
          !queue.busy &&
          !attachmentsPreparing &&
          (Boolean(text.trim()) || edit.keepAttachmentIds.length > 0 || added > 0)
        }
        pending={queue.busy}
        label="Save queued message"
        onSave={() => {
          // The controller holds the files this edit added, so a save after a restart still
          // uploads the copies this phone kept for it.
          void queue.save(text, queue.attachments).then((saved) => {
            void haptics.notification(saved ? "success" : "error");
            if (saved) exitAfter(null, () => router.back());
          });
        }}
      />

      <QueuedEditAttachments queue={queue} kept={kept} onPreparingChange={setAttachmentsPreparing} />

      <SettingsSection>
        <SettingsRow disclosure={false} disabled={queue.busy} onPress={() => releaseThenExit(() => router.back())}>
          <Typography className="text-danger-text">Cancel edit</Typography>
        </SettingsRow>
      </SettingsSection>

      <SettingsNote>
        {queue.progress === null
          ? edit.pendingSave
            ? "Save is not confirmed. Retry Save to check the result."
            : "The agent waits for this message until you save it."
          : `Uploading ${queue.progress} of ${added} files…`}
      </SettingsNote>

      {queue.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {queue.error}
        </Typography.Paragraph>
      ) : null}
    </SettingsContent>
  );
}

function AttachmentRemoveButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const muted = useThemeColor("muted");
  return (
    <Button isIconOnly variant="ghost" isDisabled={disabled} accessibilityLabel={label} onPress={onPress}>
      <X color={String(muted)} size={18} />
    </Button>
  );
}

/**
 * The files of this edit: the ones the queued message already has, and the ones this phone adds.
 * The controller keeps added files on the device, so the list survives navigation and a restart
 * until the edit is saved or cancelled.
 */
function QueuedEditAttachments({
  queue,
  kept,
  onPreparingChange,
}: {
  queue: ChatQueueController;
  kept: AttachmentSummary[];
  onPreparingChange?: (preparing: boolean) => void;
}) {
  const muted = useThemeColor("muted");
  const attachments = useChatAttachments(queue.attachments, queue.changeAttachments);
  const busy = queue.busy || attachments.preparing || Boolean(queue.edit?.pendingSave);
  useEffect(() => {
    onPreparingChange?.(attachments.preparing);
  }, [attachments.preparing, onPreparingChange]);
  return (
    <SettingsSection title="Attachments">
      {kept.map((file) => (
        <KeptAttachmentRow
          key={file.id}
          attachment={file}
          serverId={queue.serverId}
          disabled={busy}
          onRemove={() => queue.removeAttachment(file.id)}
        />
      ))}
      {attachments.items.map((file) => (
        <SettingsRow
          key={file.id}
          leading={<AttachmentThumbnail name={file.name} uri={localAttachmentPreview(file)} />}
          supportingText="Added on this phone"
          trailing={
            <AttachmentRemoveButton
              label={`Remove ${file.name}`}
              disabled={busy}
              onPress={() => attachments.remove(file.id)}
            />
          }
        >
          <Typography numberOfLines={1}>{file.name}</Typography>
        </SettingsRow>
      ))}
      <SettingsRow
        disclosure={false}
        disabled={busy}
        leading={<AddIcon>{<Paperclip color={String(muted)} size={22} />}</AddIcon>}
        onPress={() => void attachments.chooseFiles()}
      >
        <Typography>Add files</Typography>
      </SettingsRow>
      <SettingsRow
        disclosure={false}
        disabled={busy}
        leading={<AddIcon>{<ImagePlus color={String(muted)} size={22} />}</AddIcon>}
        onPress={() => void attachments.choosePhotos()}
      >
        <Typography>Add photos</Typography>
      </SettingsRow>
    </SettingsSection>
  );
}

/** Keeps the add actions on the same left edge as the file thumbnails above them. */
function AddIcon({ children }: PropsWithChildren) {
  return <View className="size-10 items-center justify-center">{children}</View>;
}

/** A file the queued message already has. Its thumbnail comes from the host, like in the chat. */
function KeptAttachmentRow({
  attachment,
  serverId,
  disabled,
  onRemove,
}: {
  attachment: AttachmentSummary;
  serverId: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const image = attachment.kind === "image";
  const file = useAttachmentFile(serverId, attachment, image);
  return (
    <SettingsRow
      leading={<AttachmentThumbnail name={attachment.name} uri={image ? file.uri : null} />}
      trailing={<AttachmentRemoveButton label={`Remove ${attachment.name}`} disabled={disabled} onPress={onRemove} />}
    >
      <Typography numberOfLines={1}>{attachment.name}</Typography>
    </SettingsRow>
  );
}
