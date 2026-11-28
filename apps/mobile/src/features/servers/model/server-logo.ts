import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { bytesToBase64 } from "@openbot/team-client/base64";
import { fetchMobileAccount } from "@/features/auth/api/account-fetch";

export const SERVER_AVATAR_CORNER_RATIO = 0.32;

export async function loadServerLogo(
  session: { apiUrl: string; sessionToken: string },
  serverId: string,
  logoKey: string,
): Promise<string> {
  const path = `/v2/remote/hosts/${encodeURIComponent(serverId)}/logo?v=${encodeURIComponent(logoKey)}`;
  const response = await fetchMobileAccount(session, path);
  if (!response.ok) throw new Error(`The server logo is unavailable (${response.status}).`);
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (!isAvatarMimeType(mimeType)) throw new Error("The server logo is not an image.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}
