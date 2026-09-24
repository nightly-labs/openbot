// Team API requests that the web client and the mobile app send in the same way.
//
// Each client has its own transport and its own error text for most responses, so only the requests
// whose path, body and decoding are the same in both are here. A request that differs in one of them
// stays at its call site.

import {
  type AttachmentSummary,
  BROWSER_SECRET_RESPONSE_PATH,
  isAttachmentSummary,
  type RespondToBrowserSecretInput,
  type RespondToBrowserTakeoverInput,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { RemoteFileUpload } from "./file-upload";

/** One request to the selected host. It rejects when the host fails or `decode` rejects the body. */
export type TeamApiRequest = <T>(
  method: string,
  path: string,
  decode: (value: unknown) => T,
  body?: TeamProtocolV2Json,
  upload?: RemoteFileUpload,
) => Promise<T>;

function ignoreResponse(): void {}

function decodeAttachment(value: unknown): AttachmentSummary {
  if (!isAttachmentSummary(value)) throw new Error("The host returned an invalid attachment.");
  return value;
}

/** Sends a file as an attachment draft. The host keeps it until a message uses it or it is discarded. */
export function uploadAttachmentDraft(request: TeamApiRequest, upload: RemoteFileUpload): Promise<AttachmentSummary> {
  const query = new URLSearchParams({ name: upload.name, mime: upload.mimeType });
  return request("POST", `${TEAM_API_ROUTES.attachments}?${query}`, decodeAttachment, undefined, upload);
}

export function discardAttachmentDraft(request: TeamApiRequest, attachmentId: string): Promise<void> {
  return request("DELETE", TEAM_API_ROUTES.attachment(attachmentId), ignoreResponse);
}

export function interruptAgentTurn(request: TeamApiRequest, agentId: string, turnId: string): Promise<void> {
  return request("POST", TEAM_API_ROUTES.agent.interrupt(agentId), ignoreResponse, { turnId });
}

export function deleteAgent(request: TeamApiRequest, agentId: string): Promise<void> {
  return request("DELETE", TEAM_API_ROUTES.agent.one(agentId), ignoreResponse);
}

export function respondToBrowserTakeover(request: TeamApiRequest, input: RespondToBrowserTakeoverInput): Promise<void> {
  return request("POST", TEAM_API_ROUTES.respond.browserTakeover, ignoreResponse, { ...input });
}

export function respondToBrowserSecret(request: TeamApiRequest, input: RespondToBrowserSecretInput): Promise<void> {
  return request("POST", BROWSER_SECRET_RESPONSE_PATH, ignoreResponse, { ...input });
}
