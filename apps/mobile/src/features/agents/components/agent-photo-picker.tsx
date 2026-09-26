import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type { Href } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ImagePlus, Trash2 } from "lucide-react-native";
import { useRef, useState } from "react";
import { pickAvatarPhoto } from "@/shared/lib/pick-avatar-photo";
import { useText } from "@/shared/lib/text";

export interface AgentPhotoDraft extends RemoteFileUpload {
  uri: string;
}

// Renders inline icon buttons, so the parent row places them beside the other choices.
export function AgentPhotoPicker({
  hasPhoto,
  cropRoute,
  disabled,
  onChange,
  onBusyChange,
}: {
  hasPhoto: boolean;
  cropRoute: Href;
  disabled: boolean;
  onChange: (photo: AgentPhotoDraft | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t, errorMessage } = useText();
  const foreground = useThemeColor("foreground");
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function choose() {
    if (disabled || pending.current) return;
    pending.current = true;
    onBusyChange(true);
    setError(null);
    try {
      const photo = await pickAvatarPhoto(cropRoute);
      if (photo) onChange({ uri: photo.uri, name: photo.name, mimeType: photo.mimeType, base64: photo.base64 });
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.agent.photo.openFailed")));
    } finally {
      pending.current = false;
      onBusyChange(false);
    }
  }
  return (
    <>
      <Button
        isIconOnly
        variant="ghost"
        accessibilityLabel={t(hasPhoto ? "mobile.agent.photo.change" : "mobile.agent.photo.add")}
        isDisabled={disabled}
        onPress={() => void choose()}
      >
        <ImagePlus color={foreground} size={20} />
      </Button>
      {hasPhoto ? (
        <Button
          isIconOnly
          variant="ghost"
          accessibilityLabel={t("mobile.agent.photo.remove")}
          isDisabled={disabled}
          onPress={() => {
            setError(null);
            onChange(null);
          }}
        >
          <Trash2 color={foreground} size={20} />
        </Button>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" align="center" className="w-full text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </>
  );
}
