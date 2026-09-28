import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { fetch } from "expo/fetch";

/**
 * Reads the server logo from the account service as a data URI. The route needs the session
 * token, so the app sends the request itself rather than giving the URL to the image view.
 */
export async function loadServerLogo(
  session: { apiUrl: string; sessionToken: string },
  serverId: string,
  logoKey: string,
): Promise<string> {
  const path = `/v2/remote/hosts/${encodeURIComponent(serverId)}/logo?v=${encodeURIComponent(logoKey)}`;
  const response = await fetch(new URL(path, session.apiUrl).toString(), {
    headers: { Authorization: `Bearer ${session.sessionToken}` },
  });
  // A 404 can come before the host has finished its upload; the query tries again.
  if (!response.ok) throw new Error(`The server logo is unavailable (${response.status}).`);
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (!isAvatarMimeType(mimeType)) throw new Error("The server logo is not an image.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${btoa(binary)}`;
}
