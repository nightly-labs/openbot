import { isAvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { userErrorMessage } from "@openbot/user-errors";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ImagePlus, Trash2 } from "lucide-react-native";
import { useRef, useState } from "react";

export interface AgentPhotoDraft extends RemoteFileUpload {
  uri: string;
}

// Renders inline icon buttons, so the parent row places them beside the other choices.
export function AgentPhotoPicker({
  hasPhoto,
  disabled,
  onChange,
  onBusyChange,
}: {
  hasPhoto: boolean;
  disabled: boolean;
  onChange: (photo: AgentPhotoDraft | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const foreground = useThemeColor("foreground");
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function choose() {
    if (disabled || pending.current) return;
    pending.current = true;
    onBusyChange(true);
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.3,
      });
      if (result.canceled) return;
      const [asset] = result.assets;
      if (!asset) throw new Error("Could not open this photo. Try again.");
      const file = new File(asset.uri);
      const mimeType = isAvatarMimeType(file.type) ? file.type : (asset.mimeType ?? "");
      if (!isAvatarMimeType(mimeType)) throw new Error("Choose a JPEG, PNG, or WebP photo.");
      if (file.size > AVATAR_IMAGE_LIMITS.storedBytes) throw new Error("Choose a photo smaller than 512 KB.");
      if (!isValidAvatarImage(mimeType, await file.bytes()))
        throw new Error("Choose a valid JPEG, PNG, or WebP photo.");
      onChange({ uri: asset.uri, name: file.name, mimeType, base64: await file.base64() });
    } catch (cause) {
      setError(userErrorMessage(cause, "Could not open this photo. Try again."));
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
        accessibilityLabel={hasPhoto ? "Change photo" : "Add photo"}
        isDisabled={disabled}
        onPress={() => void choose()}
      >
        <ImagePlus color={foreground} size={20} />
      </Button>
      {hasPhoto ? (
        <Button
          isIconOnly
          variant="ghost"
          accessibilityLabel="Remove photo"
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
