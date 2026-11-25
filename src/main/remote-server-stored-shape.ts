import { type CustomServerPlan, optionalCustomServerPayment } from "@openbot/contracts/custom-server-plans";
import type { ServerNotificationLevel, TeamRole } from "@openbot/contracts/ipc";
import { LOCAL_SERVER_ID, SERVER_NOTIFICATION_LEVELS } from "@openbot/contracts/ipc";
import {
  type DynamicRecord,
  isBoolean,
  isDynamicRecord,
  isNumber,
  isOneOf,
  isString,
} from "@openbot/contracts/runtime-values";
import {
  optionalServerAppearanceField,
  type ServerAppearance,
} from "@openbot/contracts/team-protocol/host-appearance-v1";

export interface StoredRemoteServer {
  id: string;
  name: string;
  apiUrl: string;
  fingerprint: string;
  publicKey?: string;
  username: string;
  encryptedToken: string;
  remoteDesktopAvailable: boolean;
  logoVersion?: string | null;
  appearance?: ServerAppearance | null;
  role: TeamRole;
  transport?: "webrtc-v2";
  memberLimit?: number;
  licenseRaisesMemberLimit?: boolean;
  hosted?: boolean;
  restartAvailable?: boolean;
  storageGb?: number;
  paymentRequired?: true;
  customPlan?: CustomServerPlan;
}

interface PreservedRemoteServer {
  beforeId: string | null;
  entry: DynamicRecord;
}

export interface StoredServerNotifications {
  level?: ServerNotificationLevel;
  mutedUntil?: number;
}

export interface StoredRemoteServers {
  version: 3;
  activeServerId: string;
  servers: StoredRemoteServer[];
  hiddenHostIds: string[];
  mutedServerIds: string[];
  serverNotifications: Record<string, StoredServerNotifications>;
  browserEgressServerIds: string[];
  unreadableServers: PreservedRemoteServer[];
  unreadableActiveServerId: string | null;
}

export function emptyStoredRemoteServers(): StoredRemoteServers {
  return {
    version: 3,
    activeServerId: LOCAL_SERVER_ID,
    servers: [],
    hiddenHostIds: [],
    mutedServerIds: [],
    serverNotifications: {},
    browserEgressServerIds: [],
    unreadableServers: [],
    unreadableActiveServerId: null,
  };
}

export function readStoredRemoteServers(value: unknown): StoredRemoteServers | null {
  if (!isDynamicRecord(value) || !isString(value.activeServerId) || !Array.isArray(value.servers)) return null;
  if (value.version !== 1 && value.version !== 2 && value.version !== 3) return null;
  const servers: StoredRemoteServer[] = [];
  const unreadableServers: PreservedRemoteServer[] = [];
  let following: string | null = null;
  for (const serverValue of [...value.servers].reverse()) {
    const server = readStoredRemoteServer(serverValue);
    if (server) {
      servers.unshift(server);
      following = server.id;
    } else if (isDynamicRecord(serverValue)) {
      unreadableServers.unshift({ beforeId: following, entry: serverValue });
    }
  }
  const hiddenHostIds = Array.isArray(value.hiddenHostIds)
    ? value.hiddenHostIds.filter((hostId): hostId is string => isString(hostId))
    : [];
  const selectable =
    value.activeServerId === LOCAL_SERVER_ID || servers.some((server) => server.id === value.activeServerId);
  const preservedActive = unreadableServers.some((preserved) => preserved.entry.id === value.activeServerId);
  return {
    version: 3,
    activeServerId: selectable ? value.activeServerId : LOCAL_SERVER_ID,
    servers,
    hiddenHostIds,
    mutedServerIds: Array.isArray(value.mutedServerIds) ? value.mutedServerIds.filter(isString) : [],
    serverNotifications: readServerNotifications(value.serverNotifications),
    browserEgressServerIds: Array.isArray(value.browserEgressServerIds)
      ? value.browserEgressServerIds.filter(isString)
      : [],
    unreadableServers,
    unreadableActiveServerId: !selectable && preservedActive ? value.activeServerId : null,
  };
}

export function serializeStoredRemoteServers(state: StoredRemoteServers): {
  version: 3;
  activeServerId: string;
  servers: (StoredRemoteServer | DynamicRecord)[];
  hiddenHostIds: string[];
  mutedServerIds: string[];
  serverNotifications: Record<string, StoredServerNotifications>;
  browserEgressServerIds: string[];
} {
  const readableIds = new Set(state.servers.map((server) => server.id));
  const claims = new Map<string, PreservedRemoteServer>();
  for (const preserved of state.unreadableServers) {
    const id = idOf(preserved.entry);
    if (id !== null && readableIds.has(id) && !claims.has(id)) claims.set(id, preserved);
  }
  const written = new Set<PreservedRemoteServer>(claims.values());
  const servers: (StoredRemoteServer | DynamicRecord)[] = [];
  for (const server of state.servers) {
    for (const preserved of state.unreadableServers) {
      if (preserved.beforeId !== server.id || written.has(preserved)) continue;
      written.add(preserved);
      servers.push(preserved.entry);
    }
    const claim = claims.get(server.id);
    servers.push(claim ? claim.entry : server);
  }
  for (const preserved of state.unreadableServers) {
    if (!written.has(preserved)) servers.push(preserved.entry);
  }
  return {
    version: state.version,
    activeServerId: state.unreadableActiveServerId ?? state.activeServerId,
    servers,
    hiddenHostIds: state.hiddenHostIds,
    mutedServerIds: state.mutedServerIds,
    serverNotifications: state.serverNotifications,
    browserEgressServerIds: state.browserEgressServerIds,
  };
}

function readServerNotifications(value: unknown): Record<string, StoredServerNotifications> {
  if (!isDynamicRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([serverId, entry]): [string, StoredServerNotifications][] => {
      if (!isDynamicRecord(entry)) return [];
      const notifications: StoredServerNotifications = {};
      if (isOneOf(SERVER_NOTIFICATION_LEVELS, entry.level)) notifications.level = entry.level;
      if (typeof entry.mutedUntil === "number" && Number.isFinite(entry.mutedUntil)) {
        notifications.mutedUntil = entry.mutedUntil;
      }
      return notifications.level === undefined && notifications.mutedUntil === undefined
        ? []
        : [[serverId, notifications]];
    }),
  );
}

function idOf(entry: DynamicRecord): string | null {
  return isString(entry.id) ? entry.id : null;
}

function readStoredRemoteServer(value: unknown): StoredRemoteServer | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !isString(value.name) ||
    !isString(value.apiUrl) ||
    !isString(value.fingerprint) ||
    !(value.publicKey === undefined || isString(value.publicKey)) ||
    !isString(value.username) ||
    !isString(value.encryptedToken) ||
    !(value.remoteDesktopAvailable === undefined || isBoolean(value.remoteDesktopAvailable)) ||
    !(value.logoVersion === undefined || value.logoVersion === null || isString(value.logoVersion)) ||
    !(value.transport === undefined || value.transport === "webrtc-v2") ||
    !isOneOf(["owner", "admin", "member"] as const, value.role)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    apiUrl: value.apiUrl,
    fingerprint: value.fingerprint,
    ...(value.publicKey === undefined ? {} : { publicKey: value.publicKey }),
    username: value.username,
    encryptedToken: value.encryptedToken,
    remoteDesktopAvailable: value.remoteDesktopAvailable ?? false,
    ...(value.logoVersion === undefined ? {} : { logoVersion: value.logoVersion }),
    role: value.role,
    ...(value.transport === undefined ? {} : { transport: value.transport }),
    ...(isPositiveInteger(value.memberLimit) ? { memberLimit: value.memberLimit } : {}),
    ...(isBoolean(value.licenseRaisesMemberLimit) ? { licenseRaisesMemberLimit: value.licenseRaisesMemberLimit } : {}),
    ...(isBoolean(value.hosted) ? { hosted: value.hosted } : {}),
    ...(isBoolean(value.restartAvailable) ? { restartAvailable: value.restartAvailable } : {}),
    ...(isPositiveInteger(value.storageGb) ? { storageGb: value.storageGb } : {}),
    ...optionalCustomServerPayment(value),
    ...optionalServerAppearanceField(value.appearance),
  };
}

function isPositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1;
}
