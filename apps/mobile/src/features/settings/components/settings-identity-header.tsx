import { Input, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Camera from "lucide-react-native/icons/camera";
import Pencil from "lucide-react-native/icons/pencil";
import { type ReactNode, useRef, useState } from "react";
import { Pressable, type TextInputInstance, View } from "react-native";
import { useCSSVariable } from "uniwind";

/** The picture beside the name. */
export const IDENTITY_PICTURE_SIZE = 72;

/**
 * The top of a settings page for a thing with a picture and a name, such as a server or a profile:
 * the picture on the left, the name beside it, and a line under the name. The name field is as wide as
 * the name, so the pencil follows the last letter, and has a soft fill while the name changes. Without
 * `onPicturePress` and `onNameChange` the header only shows.
 */
export function SettingsIdentityHeader({
  picture,
  pictureLabel,
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
            <Camera color={foreground} size={12} />
          </View>
        </Pressable>
      ) : (
        picture
      )}
      <View className="min-w-0 flex-1 gap-1">
        {onNameChange ? (
          // While the name changes, the field takes the full row, so Android does not measure and
          // draw it again at each key. Then the pencil, after the last letter, is hidden.
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
              // While the name changes, a soft rounded fill shows the size of the field. HeroUI gives an
              // Android field its own fill and elevation; the style replaces them on both platforms.
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
