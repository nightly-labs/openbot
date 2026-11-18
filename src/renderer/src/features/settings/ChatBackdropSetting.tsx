import { customBackdropChoice, customBackdropId } from "@openbot/ui/features/conversation/chat-backdrop";
import { ChatBackdropSelect } from "@openbot/ui/features/settings/ChatBackdropSelect";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { actionToast } from "../../action-toast";
import { setChatBackdrop, useChatBackdrop } from "../../chat-backdrop-preference";
import {
  addCustomBackdrop,
  CUSTOM_BACKDROP_IMAGE_TYPES,
  removeCustomBackdrop,
  useCustomBackdrops,
} from "../../custom-backdrops";
import { prepareBackdropImage } from "./backdrop-compressor";

export function ChatBackdropSetting(props: { mount?: HTMLElement | undefined }) {
  const { t } = useText();
  const choice = useChatBackdrop();
  const custom = useCustomBackdrops();
  const [busy, setBusy] = createSignal(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const prepared = await prepareBackdropImage(file);
      const id = await addCustomBackdrop(prepared);
      setChatBackdrop(customBackdropChoice(id));
    } catch (error) {
      if (error instanceof Error && error.message === "UNSUPPORTED_TYPE") {
        actionToast.error(t("settings.chatBackdrop.uploadRefused"));
      } else {
        actionToast.error(t("settings.chatBackdrop.saveFailed"));
      }
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
      accept={[...CUSTOM_BACKDROP_IMAGE_TYPES, "image/*"].join(",")}
      onUpload={(file) => void upload(file)}
      onRemove={(id) => void remove(id)}
      busy={busy()}
      mount={props.mount}
    />
  );
}
