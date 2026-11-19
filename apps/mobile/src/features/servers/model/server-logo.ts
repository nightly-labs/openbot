import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { fetch } from "@/features/support/model/logged-fetch";

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
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${btoa(binary)}`;
}
