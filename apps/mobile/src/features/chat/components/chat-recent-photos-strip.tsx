import { Image } from "expo-image";
import { FlatList, Pressable } from "react-native";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import type { RecentPhoto } from "./use-recent-photos";

const RECENT_PHOTO_SIZE = 100;
const RECENT_PHOTO_GAP = 6;
const RECENT_PHOTO_RADIUS = 12;
const STRIP_INSET = 16;

export function ChatRecentPhotosStrip({
  onPick,
  photos,
}: {
  onPick: (photo: RecentPhoto) => void;
  photos: readonly RecentPhoto[];
}) {
  const { t } = useText();
  return (
    <FlatList
      horizontal
      data={photos}
      keyExtractor={(photo) => photo.id}
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: STRIP_INSET, gap: RECENT_PHOTO_GAP }}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.chat.attachment.recentPhoto")}
          onPressIn={() => void haptics.selection()}
          onPress={() => onPick(item)}
        >
          <Image
            source={{ uri: item.id }}
            recyclingKey={item.id}
            contentFit="cover"
            transition={120}
            style={{ width: RECENT_PHOTO_SIZE, height: RECENT_PHOTO_SIZE, borderRadius: RECENT_PHOTO_RADIUS }}
          />
        </Pressable>
      )}
    />
  );
}
