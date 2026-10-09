import { isChatVisualMimeType } from "@openbot/contracts/chat-visual";

/**
 * The address of a visual reply page. The page comes from its own scheme, which serves only HTML
 * in a sandbox that lets its scripts run. A preview address of another form has no page.
 */
export function chatVisualPageUrl(previewUrl: string | null | undefined): string | undefined {
  if (!previewUrl) return undefined;
  const local = /^openbot-attachment:\/\/file\/([^/?#]+)$/.exec(previewUrl);
  if (local) return `openbot-visual://file/${local[1]}`;
  const remote = /^openbot-remote-attachment:\/\/([^/?#]+)\/([^/?#]+)$/.exec(previewUrl);
  if (remote) return `openbot-remote-visual://${remote[1]}/${remote[2]}`;
  return undefined;
}

/** The page address of an HTML attachment, which the file preview shows with its scripts. */
export function htmlAttachmentPageUrl(
  attachment: { mimeType: string; previewUrl: string | null } | null | undefined,
): string | undefined {
  return attachment && isChatVisualMimeType(attachment.mimeType) ? chatVisualPageUrl(attachment.previewUrl) : undefined;
}
