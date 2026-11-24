import { Input, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import Camera from "lucide-react-native/icons/camera";
import Pencil from "lucide-react-native/icons/pencil";
import { type ReactNode, useRef, useState } from "react";
import { Pressable, type TextInputInstance, View } from "react-native";
import { useCSSVariable } from "uniwind";

export const IDENTITY_PICTURE_SIZE = 72;

export function SettingsIdentityHeader({
  picture,
  pictureLabel,
  pictureIcon: PictureIcon = Camera,
  onPicturePress,
  name,
  nameLabel,
  namePlaceholder,
  nameMaxLength,
  disabled = false,
  onNameChange,
  onNameSubmit,
  subtitle,
}: {
  picture: ReactNode;
  pictureLabel?: string;
  pictureIcon?: LucideIcon;
  onPicturePress?: () => void;
  name: string;
  nameLabel: string;
  namePlaceholder?: string;
  nameMaxLength?: number;
  disabled?: boolean;
  onNameChange?: (value: string) => void;
  onNameSubmit?: () => void;
  subtitle: ReactNode;
}) {
  const foreground = useThemeColor("foreground");
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const grouped = String(useCSSVariable("--openbot-bg-grouped"));
  const nameInput = useRef<TextInputInstance>(null);
  const [editing, setEditing] = useState(false);
  return (
    <View className="flex-row items-center gap-4">
      {onPicturePress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pictureLabel}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPicturePress}
        >
          {picture}
          <View className="absolute -right-1.5 -bottom-1.5 size-7 items-center justify-center rounded-full border-4 border-sheet bg-grouped">
            <PictureIcon color={foreground} size={12} />
          </View>
        </Pressable>
      ) : (
        picture
      )}
      <View className="min-w-0 flex-1 gap-1">
        {onNameChange ? (
          <View className={`-ml-2 max-w-full flex-row items-center gap-1.5 ${editing ? "self-stretch" : "self-start"}`}>
            <Input
              ref={nameInput}
              accessibilityLabel={nameLabel}
              placeholder={namePlaceholder}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={nameMaxLength}
              value={name}
              editable={!disabled}
              returnKeyType="done"
              variant="primary"
              background={null}
              style={{ backgroundColor: editing ? grouped : "transparent", borderRadius: 12, elevation: 0 }}
              className={`min-h-10 min-w-16 ${editing ? "flex-1" : "shrink"} border-0 bg-transparent px-2 font-sans text-title font-semibold shadow-none ios:shadow-none ios:outline-transparent ios:focus:outline-transparent android:border-0 android:focus:border-transparent`}
              onFocus={() => setEditing(true)}
              onBlur={() => setEditing(false)}
              onSubmitEditing={onNameSubmit}
              onChangeText={onNameChange}
            />
            {editing ? null : (
              <Pressable accessible={false} hitSlop={12} disabled={disabled} onPress={() => nameInput.current?.focus()}>
                <Pencil color={muted} size={16} strokeWidth={1.75} />
              </Pressable>
            )}
          </View>
        ) : (
          <Typography.Heading type="h4" numberOfLines={2}>
            {name}
          </Typography.Heading>
        )}
        {subtitle}
      </View>
    </View>
  );
}
