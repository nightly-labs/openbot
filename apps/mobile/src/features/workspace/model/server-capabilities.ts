import { TEAM_BROWSER_VIEW_CAPABILITY } from "@openbot/contracts/team-protocol/browser-view-v1";
import type { TeamProtocolV1Capability } from "@openbot/contracts/team-protocol/v1";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { currentText } from "@/shared/lib/text";

export type ServerCapabilities = ReadonlyMap<string, readonly string[]>;

export const SIDEBAR_LAYOUT_CAPABILITY = "sidebar-layout" satisfies TeamProtocolV1Capability;
const BROWSER_CONTROL_CAPABILITY = "browser-control" satisfies TeamProtocolV1Capability;

export function hasCapability(
  capabilities: ServerCapabilities,
  serverId: string | null | undefined,
  capability: string,
): boolean {
  return Boolean(serverId && capabilities.get(serverId)?.includes(capability));
}

export function requireCapability(
  capabilities: ServerCapabilities,
  serverId: string,
  capability: string,
  unsupported: MobileTextKey,
): void {
  if (!hasCapability(capabilities, serverId, capability)) throw new Error(currentText().t(unsupported));
}

export function supportsBrowserView(capabilities: readonly string[]): boolean {
  return capabilities.includes(BROWSER_CONTROL_CAPABILITY) && capabilities.includes(TEAM_BROWSER_VIEW_CAPABILITY);
}
