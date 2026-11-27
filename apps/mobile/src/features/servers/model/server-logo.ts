import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { bytesToBase64 } from "@openbot/team-client/base64";
import { fetch } from "@/features/support/model/logged-fetch";

export const SERVER_AVATAR_CORNER_RATIO = 0.32;

export async function loadServerLogo(
  session: { apiUrl: string; sessionToken: string },
  serverId: string,
  logoKey: string,
): Promise<string> {
  const path = `/v2/remote/hosts/${encodeURIComponent(serverId)}/logo?v=${encodeURIComponent(logoKey)}`;
  const response = await fetch(new URL(path, session.apiUrl).toString(), {
    headers: { Authorization: `Bearer ${session.sessionToken}` },
  });
  if (!response.ok) throw new Error(`The server logo is unavailable (${response.status}).`);
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (!isAvatarMimeType(mimeType)) throw new Error("The server logo is not an image.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}
