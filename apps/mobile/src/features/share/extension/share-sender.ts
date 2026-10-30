/**
 * The page that the iOS share extension runs in a hidden web view. It sends one share to one agent
 * without the app: it opens a peer to the host, uploads the files, sends the message, and closes the
 * peer. The app's peer runs in a web view too, because WebRTC is there. `plugins/with-share-target.js`
 * bundles this file at prebuild; Metro does not load it.
 *
 * The native side does every request to the account service, so the page has no CORS rules to meet,
 * and it gives each file only when the page asks for it, so one file at a time is in memory.
 */

import { isQueuedMessageReceipt } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_MESSAGE_CLIENT_ID_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
import { decodeTeamProtocolSupportV7Base } from "@openbot/contracts/team-protocol/v7-base";
import { runTeamEffect } from "@openbot/team-client";
import { verifyEd25519Base64Url } from "@openbot/team-client/ed25519";
import { RemoteTeamDirectoryClient } from "@openbot/team-client/remote-directory";
import {
  createRemoteTeamPeer,
  MOBILE_ATTACHMENT_BYTES,
  type RemoteFileUpload,
  type RemoteTeamPeerActions,
} from "@openbot/team-client/remote-peer";

/** What the extension asks the page to send. The extension has checked the values. */
interface ShareSendRequest {
  apiUrl: string;
  sessionToken: string;
  hostId: string;
  hostPublicKey: string;
  /** A hosted server can sleep. The page then asks it to start and waits for it. */
  hosted: boolean;
  agentId: string;
  text: string;
  files: { name: string; mimeType: string }[];
  clientMessageId: string;
  timezone: string;
}

/**
 * `stage` names the step that failed, for the support line of the extension. `error` is the English
 * text of the failure; the extension shows its own localized text. `unconfirmed`: the message request
 * went out, and no answer came, so the message can be in the chat. The extension must not offer to
 * send it again.
 */
type ShareSendResult =
  | { ok: true }
  | { ok: false; stage: string; error: string; reference: string | null; unconfirmed: boolean };

interface NativeFetchReply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

type NativeMessage =
  | { type: "fetch"; url: string; method: string; headers: Record<string, string>; body: string | null }
  | { type: "file"; index: number };

declare global {
  /** The page's globals: the handler that `ShareSender.swift` registers, and the function it calls. */
  interface Window {
    webkit?: { messageHandlers?: { openbot?: { postMessage(message: NativeMessage): Promise<unknown> } } };
    openbotShareSend?: (request: ShareSendRequest) => Promise<ShareSendResult>;
  }
}

/**
 * How long the connection and the uploads can take before the extension offers the app. A hosted
 * server can take this long to start. The message request has its own wait, so it is never cut.
 */
const PREPARE_DEADLINE_MS = 90_000;
const MESSAGE_TIMEOUT_MS = 30_000;

class ShareStageError extends Error {
  constructor(
    readonly stage: string,
    message: string,
    readonly reference: string | null = null,
    readonly unconfirmed = false,
  ) {
    super(message);
  }
}

/** Sends a message to the extension and reads its reply with `decode`. */
async function postNative<T>(message: NativeMessage, decode: (reply: unknown) => T): Promise<T> {
  const handler = window.webkit?.messageHandlers?.openbot;
  if (!handler) throw new Error("The share extension bridge is missing.");
  return decode(await handler.postMessage(message));
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function decodeFetchReply(value: unknown): NativeFetchReply {
  if (!isDynamicRecord(value) || !isNumber(value.status) || !isString(value.body) || !isDynamicRecord(value.headers)) {
    throw new Error("The account service did not answer.");
  }
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(value.headers)) if (isString(header)) headers[key] = header;
  return { status: value.status, headers, body: value.body };
}

function decodeFileReply(value: unknown): string {
  if (!isString(value)) throw new Error("The shared file could not be read.");
  return value;
}

function whenNotAborted<T>(promise: Promise<T>, signal: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** A fetch that the extension runs with URLSession. It answers only the account service of the share. */
const nativeFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const body = init?.body;
  if (body !== undefined && body !== null && typeof body !== "string") throw new Error("Only text bodies are sent.");
  const reply = postNative(
    { type: "fetch", url, method: init?.method ?? "GET", headers: headerRecord(init?.headers), body: body ?? null },
    decodeFetchReply,
  );
  // The native request cannot stop, but the caller's timeout must still end its wait.
  const answer = await whenNotAborted(reply, init?.signal ?? null);
  const empty = answer.status === 204 || answer.status === 205 || answer.status === 304;
  return new Response(empty ? null : answer.body, { status: answer.status, headers: answer.headers });
};

function readFile(index: number): Promise<string> {
  return postNative({ type: "file", index }, decodeFileReply);
}

function failure(error: unknown): Extract<ShareSendResult, { ok: false }> {
  if (error instanceof ShareStageError) {
    return {
      ok: false,
      stage: error.stage,
      error: error.message,
      reference: error.reference,
      unconfirmed: error.unconfirmed,
    };
  }
  return {
    ok: false,
    stage: "unknown",
    error: error instanceof Error ? error.message : String(error),
    reference: isDynamicRecord(error) && isString(error.reference) ? error.reference : null,
    unconfirmed: false,
  };
}

function deadline(stage: string, ms: number): { promise: Promise<never>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ShareStageError(stage, "The share took too long.", "share/timeout")), ms);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

async function send(request: ShareSendRequest): Promise<void> {
  const directory = new RemoteTeamDirectoryClient({
    apiUrl: request.apiUrl,
    token: request.sessionToken,
    fetch: nativeFetch,
    verifyHostKeySignature: verifyEd25519Base64Url,
  });
  let wakeRequested = false;
  const actions: { current: RemoteTeamPeerActions } = {
    current: {
      getBootstrap: (hostId, clientPublicKey, existingSessionId) =>
        runTeamEffect(directory.createBootstrap(hostId, clientPublicKey, existingSessionId)),
      endSession: (sessionId) => runTeamEffect(directory.endSession(sessionId)),
      onConnectionUpdate: async (update) => {
        // Signal holds the attempt while a hosted server is offline. A start request wakes it, as the app does.
        if (!update.hostOffline || !request.hosted || wakeRequested) return;
        wakeRequested = true;
        const wake = new URL(`/v2/hosting/servers/${encodeURIComponent(request.hostId)}/wake`, request.apiUrl);
        await nativeFetch(wake, {
          method: "POST",
          headers: { authorization: `Bearer ${request.sessionToken}` },
        }).catch(() => undefined);
      },
      onTeamEvent: async () => undefined,
    },
  };
  const peer = createRemoteTeamPeer(actions, { waitForHost: request.hosted });
  let commands = 0;
  const teamRequest = async (
    stage: string,
    command: { method: string; path: string; body?: TeamProtocolV2Json; upload?: RemoteFileUpload; timeoutMs?: number },
  ) => {
    commands += 1;
    const result = await peer.execute({ body: {}, ...command, id: `share-${commands}`, type: "request" });
    if (!result.ok) throw new ShareStageError(stage, result.error ?? "The request failed.", result.reference ?? null);
    if (result.status !== undefined && result.status >= 400) {
      const body = result.body;
      const error = isDynamicRecord(body) && isString(body.error) ? body.error : `HTTP ${result.status}`;
      throw new ShareStageError(stage, error, `http/${result.status}`);
    }
    return result.body;
  };

  const draftIds: string[] = [];
  try {
    const prepare = deadline("prepare", PREPARE_DEADLINE_MS);
    let capabilities: readonly string[];
    try {
      capabilities = await Promise.race([
        (async () => {
          const connected = await peer.execute({
            id: "share-connect",
            type: "connect",
            hostId: request.hostId,
            hostPublicKey: request.hostPublicKey,
          });
          if (!connected.ok) {
            throw new ShareStageError("connect", connected.error ?? "No connection.", connected.reference ?? null);
          }
          const compatibility = decodeTeamProtocolSupportV7Base(
            await teamRequest("compatibility", { method: "GET", path: TEAM_API_ROUTES.compatibility }),
          );
          const { minimum, maximum } = compatibility.protocol;
          if (minimum > TEAM_PROTOCOL_V3 || maximum < TEAM_PROTOCOL_V3) {
            throw new ShareStageError("compatibility", "The server needs another OpenBot version.");
          }
          for (const [index, file] of request.files.entries()) {
            const query = new URLSearchParams({ name: file.name, mime: file.mimeType });
            const draft = await teamRequest("upload", {
              method: "POST",
              path: `${TEAM_API_ROUTES.attachments}?${query}`,
              upload: {
                name: file.name,
                mimeType: file.mimeType,
                base64: await readFile(index),
                maxBytes: MOBILE_ATTACHMENT_BYTES,
              },
            });
            if (!isDynamicRecord(draft) || !isString(draft.id)) {
              throw new ShareStageError("upload", "The host returned an invalid attachment.");
            }
            draftIds.push(draft.id);
          }
          return compatibility.capabilities;
        })(),
        prepare.promise,
      ]);
    } finally {
      prepare.clear();
    }
    const receipt = await teamRequest("message", {
      method: "POST",
      path: TEAM_API_ROUTES.agent.messages(request.agentId),
      body: {
        text: request.text,
        attachmentDraftIds: draftIds,
        replyToMessageId: null,
        timezone: request.timezone,
        // A host with this capability stores a repeat of the message once.
        ...(capabilities.includes(TEAM_MESSAGE_CLIENT_ID_CAPABILITY)
          ? { clientMessageId: request.clientMessageId }
          : {}),
      },
      timeoutMs: MESSAGE_TIMEOUT_MS,
    }).catch((error: unknown) => {
      // A refusal from the host is an answer: the message is not in the chat.
      if (error instanceof ShareStageError && error.reference?.startsWith("http/")) throw error;
      const { error: message, reference } = failure(error);
      throw new ShareStageError("message", message, reference, true);
    });
    // The host answered, so it can have stored the message.
    if (!isQueuedMessageReceipt(receipt)) {
      throw new ShareStageError("message", "The host returned an invalid receipt.", null, true);
    }
  } catch (error) {
    // The drafts of a message that the host refused, or that never went, are discarded, as the app does.
    // A message without an answer can use them, so they stay.
    if (!(error instanceof ShareStageError && error.unconfirmed)) {
      for (const draftId of draftIds) {
        await teamRequest("discard", { method: "DELETE", path: TEAM_API_ROUTES.attachment(draftId) }).catch(
          () => undefined,
        );
      }
    }
    throw error;
  } finally {
    await peer.dispose().catch(() => undefined);
  }
}

async function openbotShareSend(request: ShareSendRequest): Promise<ShareSendResult> {
  try {
    await send(request);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

window.openbotShareSend = openbotShareSend;
