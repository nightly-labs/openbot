import {
  decodeAgentProfileDraft,
  decodeSaveAgentProfileResult,
  parseGenerateAgentProfile,
  parseSaveAgentProfile,
} from "../ipc-agent-profile";
import { isDynamicRecord } from "../runtime-values";
import { toCurrentAgentKeys, toWireAgentKeys } from "./current-agent-keys";
import type { TeamProtocolV1JsonObject, TeamProtocolV1JsonValue } from "./v1";

/**
 * Current-side route checks that the v3 and v4 adapters share. They read the path and the app's own
 * IPC decoders only. Each adapter passes its own frozen profile codec to `currentProfileRoutes`, so
 * no released protocol takes another version's rules.
 */

export function decodeUnreadRequest(value: unknown): TeamProtocolV1JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw new Error("Invalid conversation-unread request.");
  }
  return {};
}

export function readPath(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname.replace(/\/unread$/u, "/read");
}

export function scopedUsageRoute(method: string, path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return method === "GET" && /^\/v1\/agents\/[^/]+\/usage$/u.test(pathname);
}

export function decodeScopedUsageRequest(value: unknown): TeamProtocolV1JsonObject {
  if (!isDynamicRecord(value) || Object.keys(value).length > 0) {
    throw new Error("Invalid model-scoped usage request.");
  }
  return {};
}

export function duplicateRoute(method: string, path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return method === "POST" && /^\/v1\/agents\/[^/]+\/duplicate$/u.test(pathname);
}

interface FrozenProfileCodec {
  decodeRequest(generate: boolean, value: unknown): TeamProtocolV1JsonObject;
  decodeResponse(generate: boolean, value: unknown): TeamProtocolV1JsonObject;
}

/** The profile routes of one adapter, checked by its frozen codec and by the current IPC decoders. */
export function currentProfileRoutes(frozen: FrozenProfileCodec) {
  return {
    encodeRequest(path: string, value: unknown): TeamProtocolV1JsonObject {
      return frozen.decodeRequest(profileGeneration(path), profileRequest(path, value));
    },
    decodeRequest(path: string, value: unknown): TeamProtocolV1JsonObject {
      return profileRequest(path, frozen.decodeRequest(profileGeneration(path), value));
    },
    encodeResponse(path: string, value: unknown): TeamProtocolV1JsonObject {
      const parsed = profileResponse(path, value);
      return frozen.decodeResponse(
        profileGeneration(path),
        profileGeneration(path)
          ? parsed
          : {
              agent: toWireAgentKeys(profileAgent(parsed)),
              layout: parsed.layout,
            },
      );
    },
    decodeResponse(path: string, value: unknown): TeamProtocolV1JsonObject {
      const parsed = frozen.decodeResponse(profileGeneration(path), value);
      return profileResponse(
        path,
        profileGeneration(path)
          ? parsed
          : {
              agent: toCurrentAgentKeys(profileAgent(parsed)),
              layout: parsed.layout,
            },
      );
    },
  };
}

function profileRequest(path: string, value: unknown): TeamProtocolV1JsonObject {
  const parsed = profileGeneration(path) ? parseGenerateAgentProfile(value) : parseSaveAgentProfile(value);
  return JSON.parse(JSON.stringify(parsed));
}

function profileResponse(path: string, value: unknown): TeamProtocolV1JsonObject {
  const parsed = profileGeneration(path) ? decodeAgentProfileDraft(value) : decodeSaveAgentProfileResult(value);
  return JSON.parse(JSON.stringify(parsed));
}

// Only a saved-profile result reaches this, and both of its decoders set `agent`.
function profileAgent(parsed: TeamProtocolV1JsonObject): TeamProtocolV1JsonValue {
  if (parsed.agent === undefined) throw new Error("Invalid agent profile.");
  return parsed.agent;
}

function profileGeneration(path: string): boolean {
  return new URL(path, "http://openbot.invalid").pathname.endsWith("/generate");
}
