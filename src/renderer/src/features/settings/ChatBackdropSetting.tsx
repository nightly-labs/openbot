import { customBackdropChoice, customBackdropId } from "@openbot/ui/features/conversation/chat-backdrop";
import { ChatBackdropSelect } from "@openbot/ui/features/settings/ChatBackdropSelect";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { actionToast } from "../../action-toast";
import { setChatBackdrop, useChatBackdrop } from "../../chat-backdrop-preference";
import {
  addCustomBackdrop,
  CUSTOM_BACKDROP_IMAGE_TYPES,
  customBackdropKind,
  removeCustomBackdrop,
  useCustomBackdrops,
} from "../../custom-backdrops";

/**
 * The backdrop control in Settings on the desktop and in the web client. It keeps an uploaded picture
 * in this browser's store (`custom-backdrops.ts`) and removes a backdrop that the user added.
 */
export function ChatBackdropSetting(props: { mount?: HTMLElement | undefined }) {
  const { t } = useText();
  const choice = useChatBackdrop();
  const custom = useCustomBackdrops();
  const [busy, setBusy] = createSignal(false);

  const upload = async (file: File) => {
    if (customBackdropKind(file.type, file.size) !== "image") {
      actionToast.error(t("settings.chatBackdrop.uploadRefused"));
      return;
    }
    setBusy(true);
    try {
      const id = await addCustomBackdrop({
        name: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      setChatBackdrop(customBackdropChoice(id));
    } catch {
      actionToast.error(t("settings.chatBackdrop.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await removeCustomBackdrop(id);
      const current = choice();
      if (current !== null && customBackdropId(current) === id) setChatBackdrop(null);
    } catch {
      actionToast.error(t("settings.chatBackdrop.removeFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChatBackdropSelect
      value={choice()}
      onChange={setChatBackdrop}
      custom={custom()}
      accept={CUSTOM_BACKDROP_IMAGE_TYPES.join(",")}
      onUpload={(file) => void upload(file)}
      onRemove={(id) => void remove(id)}
      busy={busy()}
      mount={props.mount}
    />
  );
}
