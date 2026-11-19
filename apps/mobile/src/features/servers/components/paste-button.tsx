import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import { Pressable } from "react-native";
import { useCSSVariable } from "uniwind";
import { readClipboardText } from "@/shared/lib/clipboard";
import { useText } from "@/shared/lib/text";

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
        void readClipboardText().then(
          (text) => {
            if (text) onPaste(text);
          },
          () => undefined,
        )
      }
    >
      <ClipboardPaste size={18} strokeWidth={1.8} color={muted} />
    </Pressable>
  );
}
