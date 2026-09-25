import { type Href, router } from "expo-router";

export interface AvatarCropSource {
  uri: string;
  width: number;
  height: number;
}

/** A square in the source image's pixels. */
export interface AvatarCrop {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface AvatarCropRequest {
  source: AvatarCropSource;
  resolve: (crop: AvatarCrop | null) => void;
}

// The crop screen is a route, so the photo and the answer pass through here, not through params.
let pending: AvatarCropRequest | null = null;

/** Opens the crop screen and resolves with the chosen square, or null when the user goes back. */
export function requestAvatarCrop(source: AvatarCropSource, route: Href): Promise<AvatarCrop | null> {
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { source, resolve };
    router.push(route);
  });
}

export function currentAvatarCropRequest(): AvatarCropRequest | null {
  return pending;
}

export function finishAvatarCrop(request: AvatarCropRequest, crop: AvatarCrop | null) {
  if (pending !== request) return;
  pending = null;
  request.resolve(crop);
}
