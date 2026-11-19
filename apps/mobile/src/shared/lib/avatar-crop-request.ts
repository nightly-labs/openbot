import { type Href, router } from "expo-router";

export interface AvatarCropSource {
  uri: string;
  width: number;
  height: number;
}

export interface AvatarCrop {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface AvatarCropRequest {
  source: AvatarCropSource;
  cornerRatio: number;
  resolve: (crop: AvatarCrop | null) => void;
}

let pending: AvatarCropRequest | null = null;

export function requestAvatarCrop(
  source: AvatarCropSource,
  route: Href,
  cornerRatio: number,
): Promise<AvatarCrop | null> {
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { source, cornerRatio, resolve };
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
