import { optionalCustomServerPayment } from "@openbot/contracts/custom-server-plans";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { optionalServerAppearanceField } from "@openbot/contracts/team-protocol/host-appearance-v1";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";

function cacheKey(accountId: string): string {
  return `openbot.web.hosts:${accountId}`;
}

function decodeHost(value: unknown): RemoteTeamHost | null {
  if (!isDynamicRecord(value)) return null;
  const hostId = value.hostId;
  const name = value.name;
  const devicePublicKey = value.devicePublicKey;
  const membershipId = value.membershipId;
  const role = value.role;
  if (
    !isString(hostId) ||
    !isString(name) ||
    !(value.logoKey === null || isString(value.logoKey)) ||
    !isString(devicePublicKey) ||
    !isString(membershipId) ||
    (role !== "owner" && role !== "admin" && role !== "member")
  )
    return null;
  const host: RemoteTeamHost = {
    hostId,
    name,
    logoKey: value.logoKey,
    devicePublicKey,
    membershipId,
    role,
    ...optionalServerAppearanceField(value.appearance),
    ...optionalCustomServerPayment(value),
  };
  if (isNumber(value.memberLimit)) host.memberLimit = value.memberLimit;
  if (isBoolean(value.licenseRaisesMemberLimit)) host.licenseRaisesMemberLimit = value.licenseRaisesMemberLimit;
  if (isBoolean(value.hosted)) host.hosted = value.hosted;
  if (isBoolean(value.restartAvailable)) host.restartAvailable = value.restartAvailable;
  if (isNumber(value.storageGb)) host.storageGb = value.storageGb;
  if (isNumber(value.keyChangedAt)) host.keyChangedAt = value.keyChangedAt;
  return host;
}

export function readCachedWebHosts(accountId: string): RemoteTeamHost[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(accountId)) ?? "null");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const host = decodeHost(item);
      return host ? [host] : [];
    });
  } catch {
    return [];
  }
}

export function writeCachedWebHosts(accountId: string, hosts: readonly RemoteTeamHost[]): void {
  try {
    window.localStorage.setItem(cacheKey(accountId), JSON.stringify(hosts));
  } catch {}
}

export function deleteCachedWebHosts(accountId: string | null): void {
  try {
    if (accountId === null) {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith("openbot.web.hosts:")) window.localStorage.removeItem(key);
      }
      return;
    }
    window.localStorage.removeItem(cacheKey(accountId));
  } catch {}
}
