// The hand-off of a Discord guild link from the account Worker to one desktop host. The OpenBot
// Discord app's bot token stays in Signal, so the grant carries no secret. It is sealed to the host
// (`./host-grant.ts`) so that a page cannot hand the host a guild that it did not connect.

import { createHostGrantKeyPair, type HostGrantKind, openHostGrant, sealHostGrant } from "./host-grant";
import { isDynamicRecord, isString } from "./runtime-values";

const KIND: HostGrantKind = { version: 1, info: "openbot-discord-guild-grant-v1" };

/** The guild that installed the OpenBot Discord app, now linked to the host. */
export interface DiscordGuildGrant {
  guildId: string;
  guildName: string;
  appId: string;
}

export const createDiscordGuildKeyPair = createHostGrantKeyPair;

export function sealDiscordGuildGrant(hostPublicKey: string, nonce: string, grant: DiscordGuildGrant): Promise<string> {
  return sealHostGrant(KIND, hostPublicKey, nonce, grant);
}

/** Throws for a payload that another key sealed, that another sign-in asked for, or that was changed. */
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
