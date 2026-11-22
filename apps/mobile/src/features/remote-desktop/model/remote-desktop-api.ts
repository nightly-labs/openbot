import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { RemoteDesktopConnection } from "@/features/workspace/components/remote-team-transport";
import { currentText } from "@/shared/lib/text";

export interface RemoteDesktopDisplay {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface RemoteDesktopHost {
  platform: "darwin" | "win32" | "linux";
  displays: RemoteDesktopDisplay[];
  selectedDisplayId: string | null;
}

export interface RemoteDesktopViewerSession {
  id: string;
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
  if (!isDynamicRecord(value)) return invalid();
  const platform = value.platform;
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") return invalid();
  return {
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

function requireSuccess(answer: { status: number; body: unknown }): void {
  if (answer.status < 400) return;
  const text = currentText();
  const refusal = isDynamicRecord(answer.body) && isString(answer.body.error) ? answer.body.error : "";
  throw new Error(refusal ? text.sourceText(refusal) : text.t("mobile.server.remoteDesktop.failed"));
}

export async function readRemoteDesktopHost(connection: RemoteDesktopConnection): Promise<RemoteDesktopHost> {
  const answer = await connection.fetchRaw("GET", TEAM_API_ROUTES.remoteScreen.capabilities);
  requireSuccess(answer);
  return decodeHost(answer.body);
}

export async function startRemoteDesktopSession(
  connection: RemoteDesktopConnection,
): Promise<RemoteDesktopViewerSession> {
  const answer = await connection.fetchRaw("POST", TEAM_API_ROUTES.remoteScreen.sessions, {});
  requireSuccess(answer);
  return decodeSession(answer.body);
}

export async function endRemoteDesktopSession(connection: RemoteDesktopConnection, sessionId: string): Promise<void> {
  await connection.fetchRaw("DELETE", TEAM_API_ROUTES.remoteScreen.session(sessionId));
}

export async function selectRemoteDesktopDisplay(
  connection: RemoteDesktopConnection,
  displayId: string,
): Promise<void> {
  const answer = await connection.fetchRaw("PUT", TEAM_API_ROUTES.remoteScreen.display, { displayId });
  requireSuccess(answer);
}
