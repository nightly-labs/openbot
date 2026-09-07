import { Image } from "expo-image";
import { Typography } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";

interface ProfileAvatarProps {
  name: string;
  imageUrl?: string | null;
  accent?: string;
  size?: number;
  neutral?: boolean;
}

export function ProfileAvatar({ name, imageUrl, accent = "#cdadec", size = 48, neutral = false }: ProfileAvatarProps) {
  const neutralBackground = String(useCSSVariable("--openbot-border-grouped"));
  const neutralForeground = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageFailed = imageUrl === failedImageUrl;

  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <View
      className="items-center justify-center overflow-hidden"
      style={{
        backgroundColor: neutral ? neutralBackground : accent,
        borderCurve: "continuous",
        borderRadius: neutral ? size / 2 : size * 0.32,
        height: size,
        width: size,
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Typography
        weight="semibold"
        style={{
          fontSize: Math.max(12, size * 0.3),
          lineHeight: size * 0.4,
          ...(neutral ? { color: neutralForeground } : {}),
        }}
        className="text-[#100d12]"
      >
        {initials || "O"}
      </Typography>
      {imageUrl && !imageFailed ? (
        <Image
          source={{ uri: imageUrl }}
          contentFit="cover"
          style={{ height: size, position: "absolute", width: size }}
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : null}
    </View>
  );
}
