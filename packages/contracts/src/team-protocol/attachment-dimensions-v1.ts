import { type ImageSize, knownImageSize } from "../image-size";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { decodeTeamProtocolV2Json } from "./webrtc-framing";

export const TEAM_ATTACHMENT_DIMENSIONS_CAPABILITY = "attachment-dimensions-v1";

export type AttachmentSizeLookup = (attachmentIds: ReadonlySet<string>) => ReadonlyMap<string, ImageSize>;

const MAXIMUM_DEPTH = 12;

function imageAttachmentId(value: DynamicRecord): string | null {
  return isString(value.id) &&
    value.kind === "image" &&
    isString(value.mimeType) &&
    isString(value.previewKind) &&
    isNumber(value.size)
    ? value.id
    : null;
}

function collect(value: unknown, into: Map<string, ImageSize>, missing: Set<string>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, missing, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  const id = imageAttachmentId(value);
  if (id !== null && !into.has(id)) {
    const size = knownImageSize(value);
    if (size) {
      into.set(id, size);
      missing.delete(id);
    } else missing.add(id);
  }
  for (const child of Object.values(value)) collect(child, into, missing, depth + 1);
}

function sizesIn(source: unknown, sizeOf: AttachmentSizeLookup | undefined): Map<string, ImageSize> {
  const sizes = new Map<string, ImageSize>();
  const missing = new Set<string>();
  collect(source, sizes, missing, 0);
  if (sizeOf && missing.size > 0) for (const [id, size] of sizeOf(missing)) sizes.set(id, size);
  return sizes;
}

function apply(value: unknown, sizes: ReadonlyMap<string, ImageSize>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) apply(item, sizes, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  const id = imageAttachmentId(value);
  const size = id === null ? undefined : sizes.get(id);
  if (size) Object.assign(value, { width: size.width, height: size.height });
  for (const child of Object.values(value)) apply(child, sizes, depth + 1);
}

export function addAttachmentDimensions(target: unknown, source: unknown, sizeOf?: AttachmentSizeLookup): void {
  const sizes = sizesIn(source, sizeOf);
  if (sizes.size > 0) apply(target, sizes, 0);
}

export function withAttachmentDimensions(encoded: string, source: unknown, sizeOf?: AttachmentSizeLookup): string {
  const sizes = sizesIn(source, sizeOf);
  if (sizes.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, sizes, 0);
  return JSON.stringify(value);
}
