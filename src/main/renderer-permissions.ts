import { isTrustedRendererUrl } from "./trusted-renderer";

interface RendererPermissionDetails {
  mediaType?: string;
}

export function canCheckRendererPermission(
  permission: string,
  requestingOrigin: string,
  details: RendererPermissionDetails,
  developmentUrl = process.env.ELECTRON_RENDERER_URL,
): boolean {
  if (!isTrustedRendererUrl(requestingOrigin, developmentUrl)) return false;
  if (permission === "clipboard-sanitized-write") return true;
  return permission === "media" && details.mediaType === "audio";
}

/** A permission request names the frame that asks, which can be a frame inside a trusted window. */
interface RendererPermissionRequest {
  requestingUrl: string;
  isMainFrame: boolean;
  mediaTypes?: readonly string[];
}

export function canRequestRendererPermission(
  permission: string,
  request: RendererPermissionRequest,
  developmentUrl = process.env.ELECTRON_RENDERER_URL,
): boolean {
  if (!request.isMainFrame || !isTrustedRendererUrl(request.requestingUrl, developmentUrl)) return false;
  if (permission === "clipboard-sanitized-write") return true;
  const mediaTypes = request.mediaTypes ?? [];
  return permission === "media" && mediaTypes.length > 0 && mediaTypes.every((mediaType) => mediaType === "audio");
}
