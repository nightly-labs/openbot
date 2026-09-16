import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { FileText, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useQueuedMessages } from "../context/queued-messages-context";

// Text-only edit in v1: kept attachments can be removed, but new uploads stay in the
// composer flow. The save path already accepts an empty file list.
export function QueuedMessageEditScreen() {
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  const { queue } = useQueuedMessages();
  const navigation = useNavigation();
  const muted = useThemeColor("muted");
  const held = queue?.edit?.delivery ?? null;
  const delivery = held?.id === deliveryId ? held : queue?.queued.find((item) => item.id === deliveryId);
  const edit = queue?.edit ?? null;

  // The field is controlled from this screen. The controller lives on the chat screen
  // behind the sheet, so its text only returns one commit later, which loses characters
  // while typing. `changeText` still runs for the durable draft.
  const [typed, setTyped] = useState<{ editId: string; text: string } | null>(null);
  const text = edit && typed?.editId === edit.editId ? typed.text : (edit?.text ?? "");
  const dirty = edit
    ? text !== edit.delivery.text || edit.keepAttachmentIds.length !== edit.delivery.attachments.length
    : false;

  // The host hold is taken once per visit. `busy` only turns on once the controller
  // starts the request, so track it here as well and keep the failure copy until then.
  const [holding, setHolding] = useState(false);
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
        editable={!queue.busy}
        maxLength={INPUT_LIMITS.messageText}
        placeholder="Message text"
        value={text}
        onChangeText={(value) => {
          setTyped({ editId: edit.editId, text: value });
          queue.changeText(value);
        }}
      />
      <SheetSaveAction
        dirty={dirty}
        canSave={!queue.busy && (Boolean(text.trim()) || edit.keepAttachmentIds.length > 0)}
        pending={queue.busy}
        label="Save queued message"
        onSave={() => {
          void queue.save(text, []).then((saved) => {
            void haptics.notification(saved ? "success" : "error");
            if (saved) exitAfter(null, () => router.back());
          });
        }}
      />

      {kept.length > 0 ? (
        <SettingsSection title="Attachments">
          {kept.map((file) => (
            <SettingsRow
              key={file.id}
              leading={<FileText color={String(muted)} size={22} />}
              trailing={
                <Button
                  isIconOnly
                  variant="ghost"
                  isDisabled={queue.busy}
                  accessibilityLabel={`Remove ${file.name}`}
                  onPress={() => queue.removeAttachment(file.id)}
                >
                  <X color={String(muted)} size={18} />
                </Button>
              }
            >
              <Typography numberOfLines={1}>{file.name}</Typography>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}

      <SettingsSection>
        <SettingsRow disclosure={false} disabled={queue.busy} onPress={() => releaseThenExit(() => router.back())}>
          <Typography className="text-danger-text">Cancel edit</Typography>
        </SettingsRow>
      </SettingsSection>

      <SettingsNote>The agent waits for this message until you save it.</SettingsNote>

      {queue.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {queue.error}
        </Typography.Paragraph>
      ) : null}
    </SettingsContent>
  );
}
