import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Copy, Reply, TextSelect } from "lucide-react-native";
import { useCopyMessage } from "@/features/chat/components/use-copy-message";
import { useMessageActions } from "@/features/chat/context/message-actions-context";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";

export default function MessageActionsScreen() {
  const { selected } = useMessageActions();
  const foreground = useThemeColor("foreground");
  const { copy } = useCopyMessage(selected?.message.body ?? "");
  if (!selected) return null;
  return (
    <SettingsContent>
      <SettingsSection>
        <SettingsRow
          leading={<Reply color={foreground} size={22} />}
          disclosure={false}
          disabled={!selected.onReply}
          onPress={() => {
            selected.onReply?.();
            router.back();
          }}
        >
          <Typography>Reply</Typography>
        </SettingsRow>
        <SettingsRow
          leading={<Copy color={foreground} size={22} />}
          disclosure={false}
          onPress={async () => {
            if (await copy()) router.back();
          }}
        >
          <Typography>Copy</Typography>
        </SettingsRow>
        <SettingsRow
          leading={<TextSelect color={foreground} size={22} />}
          onPress={() => router.push("/message-actions/select-text")}
        >
          <Typography>Select Text</Typography>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
