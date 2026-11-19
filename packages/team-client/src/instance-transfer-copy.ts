import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

export const INSTANCE_TRANSFER_MANIFEST = "openbot-transfer.json";
const MANIFEST_MAX_BYTES = 64 * 1024 * 1024;
const LIBRARY_PREFIX = "library/";

const END = 0x06054b50;
const END_BYTES = 22;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_LOCATOR_BYTES = 20;
const CENTRAL = 0x02014b50;
const CENTRAL_BYTES = 46;
const LOCAL = 0x04034b50;
const LOCAL_BYTES = 30;
export const ZIP_TAIL_BYTES = END_BYTES + 0xffff;
const UINT32_MAX = 0xffffffff;
const UTF8_NAME = 0x800;
const DOS_DATE = 0x21;

export function copyManifestBytes(bytes: Uint8Array): Uint8Array | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!isDynamicRecord(manifest)) return null;
  return new TextEncoder().encode(JSON.stringify(copyManifest(manifest), null, 2));
}

function keysOf(items: unknown): ReadonlySet<string> {
  return new Set(
    (Array.isArray(items) ? items : []).flatMap((item) =>
      isDynamicRecord(item) && isString(item.key) ? [item.key] : [],
    ),
  );
}

function copyManifest(manifest: DynamicRecord): DynamicRecord {
  const { sharedSkills: _left, ...rest } = manifest;
  const settings = manifest.settings;
  if (!isDynamicRecord(settings)) return rest;
  const agentKeys = keysOf(manifest.agents);
  const channelKeys = keysOf(manifest.channels);
  const workflows = (Array.isArray(settings.workflows) ? settings.workflows : []).filter((workflow) =>
    usesCopiedItems(workflow, agentKeys, channelKeys),
  );
  return {
    ...rest,
    settings: {
      mcpServers: [],
      customProviders: [],
      customAgents: [],
      sidebarSections: [],
      routineFlows: Array.isArray(settings.routineFlows) ? settings.routineFlows : [],
      ...(workflows.length > 0 ? { workflows } : {}),
      ...(Array.isArray(settings.routineFlowPositions) ? { routineFlowPositions: settings.routineFlowPositions } : {}),
    },
  };
}

function usesCopiedItems(workflow: unknown, agentKeys: ReadonlySet<string>, channelKeys: ReadonlySet<string>): boolean {
  if (!isDynamicRecord(workflow) || !isDynamicRecord(workflow.graph) || !Array.isArray(workflow.graph.nodes))
    return false;
  return workflow.graph.nodes.some((node) => {
    if (!isDynamicRecord(node) || !isDynamicRecord(node.fields)) return false;
    const { agentId, channelId } = node.fields;
    return (
      (node.kind === "agent" && isString(agentId) && agentKeys.has(agentId)) ||
      (node.kind === "output" && isString(channelId) && channelKeys.has(channelId))
    );
  });
}

export function zipDirectory(tail: Uint8Array, tailStart: number): { offset: number; bytes: number } | null {
  const view = dataView(tail);
  const first = Math.max(0, tail.length - ZIP_TAIL_BYTES);
  let end = tail.length - END_BYTES;
  while (end >= first && view.getUint32(end, true) !== END) end -= 1;
  if (end < first) return null;
  const locator = end - ZIP64_LOCATOR_BYTES;
  if (locator >= 0 && view.getUint32(locator, true) === ZIP64_LOCATOR) return null;
  const bytes = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (offset + bytes > tailStart + end) return null;
  return { offset, bytes };
}

interface CentralRecord {
  name: string;
  record: Uint8Array;
  method: number;
  crc: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function centralRecords(directory: Uint8Array): CentralRecord[] | null {
  const view = dataView(directory);
  const records: CentralRecord[] = [];
  for (let offset = 0; offset < directory.length; ) {
    if (offset + CENTRAL_BYTES > directory.length || view.getUint32(offset, true) !== CENTRAL) return null;
    const nameBytes = view.getUint16(offset + 28, true);
    const next =
      offset + CENTRAL_BYTES + nameBytes + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > directory.length) return null;
    records.push({
      name: new TextDecoder().decode(directory.subarray(offset + CENTRAL_BYTES, offset + CENTRAL_BYTES + nameBytes)),
      record: directory.subarray(offset, next),
      method: view.getUint16(offset + 10, true),
      crc: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset = next;
  }
  return records;
}

export function copyTail(directory: Uint8Array, offset: number, manifest: Uint8Array): Uint8Array | null {
  const records = centralRecords(directory);
  if (!records) return null;
  const kept = records.filter(
    ({ name }) => name !== INSTANCE_TRANSFER_MANIFEST && !name.toLowerCase().startsWith(LIBRARY_PREFIX),
  );
  const name = new TextEncoder().encode(INSTANCE_TRANSFER_MANIFEST);
  const crc = crc32(manifest);
  const local = new Uint8Array(LOCAL_BYTES + name.length);
  const localView = dataView(local);
  localView.setUint32(0, LOCAL, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, UTF8_NAME, true);
  localView.setUint16(12, DOS_DATE, true);
  localView.setUint32(14, crc, true);
  localView.setUint32(18, manifest.length, true);
  localView.setUint32(22, manifest.length, true);
  localView.setUint16(26, name.length, true);
  local.set(name, LOCAL_BYTES);

  const central = new Uint8Array(CENTRAL_BYTES + name.length);
  const centralView = dataView(central);
  centralView.setUint32(0, CENTRAL, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, UTF8_NAME, true);
  centralView.setUint16(14, DOS_DATE, true);
  centralView.setUint32(16, crc, true);
  centralView.setUint32(20, manifest.length, true);
  centralView.setUint32(24, manifest.length, true);
  centralView.setUint16(28, name.length, true);
  centralView.setUint32(42, offset, true);
  central.set(name, CENTRAL_BYTES);

  const directoryOffset = offset + local.length + manifest.length;
  const directoryBytes = kept.reduce((total, { record }) => total + record.length, central.length);
  if (directoryOffset + directoryBytes > UINT32_MAX) return null;
  const count = Math.min(kept.length + 1, 0xffff);
  const end = new Uint8Array(END_BYTES);
  const endView = dataView(end);
  endView.setUint32(0, END, true);
  endView.setUint16(8, count, true);
  endView.setUint16(10, count, true);
  endView.setUint32(12, directoryBytes, true);
  endView.setUint32(16, directoryOffset, true);
  return concat([local, manifest, ...kept.map(({ record }) => record), central, end]);
}

export interface TransferFileReader {
  size: number;
  read(offset: number, length: number): Uint8Array;
}

export function copyTransfer(file: TransferFileReader): { offset: number; tail: Uint8Array } | null {
  const read = (offset: number, length: number) => {
    const bytes = file.read(offset, length);
    return bytes.length === length ? bytes : null;
  };
  const tailStart = Math.max(0, file.size - ZIP_TAIL_BYTES);
  const end = read(tailStart, file.size - tailStart);
  const location = end && zipDirectory(end, tailStart);
  if (!location) return null;
  const directory = read(location.offset, location.bytes);
  const entry = directory && centralRecords(directory)?.find(({ name }) => name === INSTANCE_TRANSFER_MANIFEST);
  const header = entry && read(entry.localHeaderOffset, LOCAL_BYTES);
  if (!directory || !entry || !header || dataView(header).getUint32(0, true) !== LOCAL) return null;
  const start =
    entry.localHeaderOffset + LOCAL_BYTES + dataView(header).getUint16(26, true) + dataView(header).getUint16(28, true);
  const stored =
    entry.compressedSize <= MANIFEST_MAX_BYTES && start + entry.compressedSize <= location.offset
      ? read(start, entry.compressedSize)
      : null;
  if (!stored) return null;
  if (entry.method !== 0 || crc32(stored) !== entry.crc) return null;
  const manifest = copyManifestBytes(stored);
  const tail = manifest && copyTail(directory, location.offset, manifest);
  return tail ? { offset: location.offset, tail } : null;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = UINT32_MAX;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ UINT32_MAX) >>> 0;
}
