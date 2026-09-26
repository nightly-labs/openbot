// Frozen decoder primitives for the optional admin wire contracts (`agent-admin-v1` and the codecs
// that follow it). Every admin codec reads its bounds from the literals it passes here, so a change
// to an IPC limit cannot move a shipped wire contract. A change to a primitive below changes every
// admin contract at once: add a new primitive instead of loosening one.
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV2Json } from "./v2";

export type AdminDecoder = (value: unknown) => TeamProtocolV2Json;
type Fields = Record<string, AdminDecoder>;

/** One admin route: the request the host accepts and the response the client accepts. */
export interface OptionalRouteCodec {
  request(value: unknown): TeamProtocolV2Json;
  response(status: number, value: unknown): TeamProtocolV2Json;
}

export const string =
  (maximum: number): AdminDecoder =>
  (value) => {
    if (!isString(value) || value.length > maximum) throw new Error("Invalid admin text.");
    return value;
  };
export const identifier: AdminDecoder = (value) => {
  if (!isString(value) || !value.length || value.length > 128) throw new Error("Invalid admin identifier.");
  return value;
};
export const boolean: AdminDecoder = (value) => {
  if (typeof value !== "boolean") throw new Error("Invalid admin flag.");
  return value;
};
export const count: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid admin count.");
  return value;
};
export const oneOf =
  (...choices: string[]): AdminDecoder =>
  (value) => {
    if (!isString(value) || !choices.includes(value)) throw new Error("Invalid admin value.");
    return value;
  };
export const nullable =
  (decode: AdminDecoder): AdminDecoder =>
  (value) =>
    value === null ? null : decode(value);
export const list =
  (decode: AdminDecoder, maximum: number): AdminDecoder =>
  (value) => {
    if (!Array.isArray(value) || value.length > maximum) throw new Error("Invalid admin list.");
    return value.map(decode);
  };

function record(value: unknown, fields: Fields): Record<string, TeamProtocolV2Json> {
  if (!isDynamicRecord(value)) throw new Error("Invalid admin record.");
  return Object.fromEntries(Object.entries(fields).map(([key, decode]) => [key, decode(value[key])]));
}

/** An absent optional field stays absent, so the IPC parser on the far side sees the shape the client built. */
function sparseRecord(value: unknown, required: Fields, optional: Fields): Record<string, TeamProtocolV2Json> {
  if (!isDynamicRecord(value)) throw new Error("Invalid admin record.");
  const decoded = record(value, required);
  for (const [key, decode] of Object.entries(optional)) if (value[key] !== undefined) decoded[key] = decode(value[key]);
  return decoded;
}

export const fields =
  (required: Fields, optional: Fields = {}): AdminDecoder =>
  (value) =>
    sparseRecord(value, required, optional);

export const empty: AdminDecoder = fields({});

const errorEnvelope = fields({ error: string(100_000) }, { code: string(128) });

export function adminRoute(request: AdminDecoder, response: AdminDecoder): OptionalRouteCodec {
  return { request, response: (status, value) => (status >= 400 ? errorEnvelope(value) : response(value)) };
}
