import { useEffect, useState } from "react";
import { isIOS } from "@/shared/lib/platform";

export interface RecentPhoto {
  id: string;
  name: string;
}

const RECENT_PHOTO_COUNT = 24;

let remembered: readonly RecentPhoto[] = [];

export function useRecentPhotos(): readonly RecentPhoto[] {
  const [photos, setPhotos] = useState<readonly RecentPhoto[]>(remembered);
  useEffect(() => {
    if (!isIOS) return;
    let cancelled = false;
    void (async () => {
      const library = await import("expo-media-library").catch(() => null);
      if (!library) return;
      try {
        let access = await library.getPermissionsAsync(false, ["photo"]);
        if (access.status === library.PermissionStatus.UNDETERMINED)
          access = await library.requestPermissionsAsync(false, ["photo"]);
        if (!access.granted) {
          remembered = [];
          return;
        }
        const found = await new library.Query()
          .eq(library.AssetField.MEDIA_TYPE, library.MediaType.IMAGE)
          .orderBy({ key: library.AssetField.CREATION_TIME, ascending: false })
          .limit(RECENT_PHOTO_COUNT)
          .exeForMetadata();
        remembered = found.map((asset) => ({ id: asset.id, name: asset.filename ?? "photo.jpg" }));
        if (!cancelled) setPhotos(remembered);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return photos;
}

export async function recentPhotoUri(id: string): Promise<string> {
  const library = await import("expo-media-library");
  return new library.Asset(id).getUri();
}
