import * as Clipboard from "expo-clipboard";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import { Pressable } from "react-native";
import { useCSSVariable } from "uniwind";
import { useText } from "@/shared/lib/text";

/**
 * The trailing Paste action of a field: the user copied the value in another app, so one tap puts
 * it in the field. iOS asks before the app reads the clipboard.
 */
export function PasteButton({ disabled, onPaste }: { disabled: boolean; onPaste: (value: string) => void }) {
  const { t } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.server.providers.paste")}
      disabled={disabled}
      hitSlop={8}
      className="px-4 py-3"
      onPress={() =>
        void Clipboard.getStringAsync().then(
          (text) => {
            if (text.trim()) onPaste(text.trim());
          },
          () => undefined,
        )
      }
    >
      <ClipboardPaste size={18} strokeWidth={1.8} color={muted} />
    </Pressable>
  );
}
