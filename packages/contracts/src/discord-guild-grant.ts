import { createHostGrantKeyPair, type HostGrantKind, openHostGrant, sealHostGrant } from "./host-grant";
import { isDynamicRecord, isString } from "./runtime-values";

const KIND: HostGrantKind = { version: 1, info: "openbot-discord-guild-grant-v1" };

export interface DiscordGuildGrant {
  guildId: string;
  guildName: string;
  appId: string;
}

export const createDiscordGuildKeyPair = createHostGrantKeyPair;

export function sealDiscordGuildGrant(hostPublicKey: string, nonce: string, grant: DiscordGuildGrant): Promise<string> {
  return sealHostGrant(KIND, hostPublicKey, nonce, grant);
}

export function openDiscordGuildGrant(
  privateKey: CryptoKey,
  nonce: string,
  payload: string,
): Promise<DiscordGuildGrant> {
  return openHostGrant(KIND, privateKey, nonce, payload, decodeDiscordGuildGrant);
}

function decodeDiscordGuildGrant(grant: unknown): DiscordGuildGrant {
  if (!isDynamicRecord(grant) || !isString(grant.guildId) || !isString(grant.guildName) || !isString(grant.appId))
    throw new Error("The Discord guild grant is invalid.");
  return { guildId: grant.guildId, guildName: grant.guildName, appId: grant.appId };
}
