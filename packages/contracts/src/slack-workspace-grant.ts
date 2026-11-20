import { createHostGrantKeyPair, type HostGrantKind, openHostGrant, sealHostGrant } from "./host-grant";
import { isDynamicRecord, isString } from "./runtime-values";

export { isRawP256PublicKey } from "./host-grant";

export const SLACK_WORKSPACE_GRANT_VERSION = 2;

const KIND: HostGrantKind = { version: SLACK_WORKSPACE_GRANT_VERSION, info: "openbot-slack-workspace-grant-v2" };

export interface SlackWorkspaceGrant {
  botToken: string;
  botUserId: string;
  appId: string;
  workspaceId: string;
  workspaceName: string;
}

export const createSlackWorkspaceKeyPair = createHostGrantKeyPair;

export function sealSlackWorkspaceGrant(
  hostPublicKey: string,
  nonce: string,
  grant: SlackWorkspaceGrant,
): Promise<string> {
  return sealHostGrant(KIND, hostPublicKey, nonce, grant);
}

export function openSlackWorkspaceGrant(
  privateKey: CryptoKey,
  nonce: string,
  payload: string,
): Promise<SlackWorkspaceGrant> {
  return openHostGrant(KIND, privateKey, nonce, payload, decodeSlackWorkspaceGrant);
}

function decodeSlackWorkspaceGrant(grant: unknown): SlackWorkspaceGrant {
  if (
    !isDynamicRecord(grant) ||
    !isString(grant.botToken) ||
    !isString(grant.botUserId) ||
    !isString(grant.appId) ||
    !isString(grant.workspaceId) ||
    !isString(grant.workspaceName)
  ) {
    throw new Error("The Slack workspace grant is invalid.");
  }
  return {
    botToken: grant.botToken,
    botUserId: grant.botUserId,
    appId: grant.appId,
    workspaceId: grant.workspaceId,
    workspaceName: grant.workspaceName,
  };
}
