import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { RemoteDesktopConnection } from "@/features/workspace/components/remote-team-transport";
import { currentText } from "@/shared/lib/text";

// The released remote screen routes, as the desktop app's `RemoteServerClient` uses them. The phone
// reads only the fields it shows.

export interface RemoteDesktopDisplay {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface RemoteDesktopHost {
  ready: boolean;
  platform: "darwin" | "win32" | "linux";
  displays: RemoteDesktopDisplay[];
  selectedDisplayId: string | null;
}

export interface RemoteDesktopViewerSession {
  id: string;
  /** Used once by the viewer page, within a minute. Never logged. */
  viewerGrant: string;
  displays: RemoteDesktopDisplay[];
  selectedDisplayId: string | null;
}

function invalid(): never {
  throw new Error(currentText().t("mobile.server.remoteDesktop.failed"));
}

function decodeDisplays(value: unknown): RemoteDesktopDisplay[] {
  if (!Array.isArray(value)) return invalid();
  return value.map((item) =>
    isDynamicRecord(item) && isString(item.id) && isString(item.label) && isNumber(item.width) && isNumber(item.height)
      ? { id: item.id, label: item.label, width: item.width, height: item.height }
      : invalid(),
  );
}

function selectedDisplayId(value: unknown): string | null {
  return isString(value) ? value : null;
}

function decodeHost(value: unknown): RemoteDesktopHost {
  if (!isDynamicRecord(value) || typeof value.ready !== "boolean") return invalid();
  const platform = value.platform;
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") return invalid();
  return {
    ready: value.ready,
    platform,
    displays: decodeDisplays(value.displays),
    selectedDisplayId: selectedDisplayId(value.selectedDisplayId),
  };
}

function decodeSession(value: unknown): RemoteDesktopViewerSession {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.viewerGrant)) return invalid();
  return {
    id: value.id,
    viewerGrant: value.viewerGrant,
    displays: decodeDisplays(value.displays),
    selectedDisplayId: selectedDisplayId(value.selectedDisplayId),
  };
}

/** A refused request names the host's reason in its error, so only a status the host sent as a value is checked here. */
function requireStatus(status: number): void {
  if (status >= 400) throw new Error(currentText().t("mobile.server.remoteDesktop.failed"));
}

export async function readRemoteDesktopHost(connection: RemoteDesktopConnection): Promise<RemoteDesktopHost> {
  const answer = await connection.fetchRaw("GET", TEAM_API_ROUTES.remoteScreen.capabilities);
  requireStatus(answer.status);
  return decodeHost(answer.body);
}

export async function startRemoteDesktopSession(
  connection: RemoteDesktopConnection,
): Promise<RemoteDesktopViewerSession> {
  const answer = await connection.fetchRaw("POST", TEAM_API_ROUTES.remoteScreen.sessions, {});
  requireStatus(answer.status);
  return decodeSession(answer.body);
}

export async function endRemoteDesktopSession(connection: RemoteDesktopConnection, sessionId: string): Promise<void> {
  await connection.fetchRaw("DELETE", TEAM_API_ROUTES.remoteScreen.session(sessionId));
}

/** The host moves every open stream to the display. The viewer connects again by itself. */
export async function selectRemoteDesktopDisplay(
  connection: RemoteDesktopConnection,
  displayId: string,
): Promise<void> {
  const answer = await connection.fetchRaw("PUT", TEAM_API_ROUTES.remoteScreen.display, { displayId });
  requireStatus(answer.status);
}
