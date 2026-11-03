import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Phone from "lucide-react-native/icons/phone";
import { useText } from "@/shared/lib/text";

export function ChatVoiceCallMarker({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <Button
      variant="ghost"
      onPress={onPress}
      accessibilityState={{ expanded }}
      accessibilityLabel={t(expanded ? "mobile.chat.voiceCall.hideDetails" : "mobile.chat.voiceCall.showDetails")}
      className="self-start"
    >
      <Phone size={16} color={muted} />
      <Typography.Paragraph type="body-sm">{t("mobile.chat.voiceCall.title")}</Typography.Paragraph>
      <Typography.Paragraph type="body-sm" className="text-muted">
        {t(expanded ? "mobile.chat.voiceCall.hideDetails" : "mobile.chat.voiceCall.showDetails")}
      </Typography.Paragraph>
      <Chevron size={16} color={muted} />
    </Button>
  );
}
