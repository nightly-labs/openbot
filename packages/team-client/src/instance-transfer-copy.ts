/**
 * Server settings > Transfer > Copy to another server moves agents with an instance transfer file.
 * The client asks the source server for the file with its server settings, then keeps only the
 * settings that belong to the copied agents: the routine flows between them, the places on their
 * routine canvas, and the workflows with a step for one of them or an output to one of their channels.
 * MCP servers, model providers, custom agents, sidebar sections and shared skills stay on the source
 * server.
 *
 * The client changes the file, not the hosts, so each host in the support window can send and read
 * it. A reader finds each entry through the central directory at the end of the file. The new
 * manifest and a new directory are written over the old directory, so the other entries are not
 * copied. The bytes of the old manifest and of the shared skills stay in the file, and nothing reads
 * them.
 *
 * Desktop main changes the file on disk (`InstanceTransferService.keepCopiedSettings`). Mobile has the
 * file in memory as Base64 and uses `copyTransfer`, which reads only the parts that it needs.
 */

import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

/** The manifest at the root of an instance transfer file. */
export const INSTANCE_TRANSFER_MANIFEST = "openbot-transfer.json";
/** The largest manifest that the copy reads, as the import (`MANIFEST_MAX_BYTES` in main). */
const MANIFEST_MAX_BYTES = 64 * 1024 * 1024;
/** The shared skills of a file (`sharedSkills`). A copy leaves them out. */
const LIBRARY_PREFIX = "library/";

const END = 0x06054b50;
const END_BYTES = 22;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_LOCATOR_BYTES = 20;
const CENTRAL = 0x02014b50;
const CENTRAL_BYTES = 46;
const LOCAL = 0x04034b50;
const LOCAL_BYTES = 30;
/** The end record can follow a comment of up to 65,535 bytes. */
export const ZIP_TAIL_BYTES = END_BYTES + 0xffff;
const UINT32_MAX = 0xffffffff;
/** Bit 11: the name is UTF-8. */
const UTF8_NAME = 0x800;
/** 1980-01-01, the first date that a ZIP entry can have. */
const DOS_DATE = 0x21;

/**
 * The copy's manifest: the manifest of the file with only the settings of the copied agents. Null when
 * the bytes are not a JSON object; the destination checks the rest, as it checks any file.
 */
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

/** The `key` of each item of a manifest list. */
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
      // The export keeps only a flow whose two agents are in the file.
      routineFlows: Array.isArray(settings.routineFlows) ? settings.routineFlows : [],
      ...(workflows.length > 0 ? { workflows } : {}),
      ...(Array.isArray(settings.routineFlowPositions) ? { routineFlowPositions: settings.routineFlowPositions } : {}),
    },
  };
}

/**
 * A workflow with a step for an agent in the file, or an output to a channel in the file. The export
 * empties a step whose agent or channel is not in the file, as the import of the file does. Only the
 * fields that name them are read: the destination checks the graph, so a node kind that is newer than
 * this app does not drop the workflow here.
 */
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

/**
 * Where the central directory is. `tail` is the end of the file, from `tailStart`. Null when there is
 * no end record, or the file has ZIP64 records, which an instance transfer file never has.
 */
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
  /** The whole record, as the directory has it. */
  record: Uint8Array;
  method: number;
  crc: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/** Each record of a central directory. Null when the directory is not valid. */
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
      // Only ASCII names are compared, so the UTF-8 flag does not matter here.
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

/**
 * The bytes that replace the central directory at `offset` and all that follows it: the new
 * manifest, as a stored entry, then a directory without the old manifest and the shared skills.
 * Null when the directory is not valid, or a value does not fit in a ZIP without ZIP64.
 */
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

/** Reads a file that is in memory in another form, such as Base64. */
export interface TransferFileReader {
  size: number;
  /** The bytes from `offset`. Fewer bytes than `length` at the end of the file. */
  read(offset: number, length: number): Uint8Array;
}

/**
 * The copy of a whole file: the bytes before `offset` stay, and `tail` replaces the rest. Null when
 * the file is not a ZIP with a manifest.
 */
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
  // An export writes the manifest stored, not compressed. The CRC shows a damaged manifest.
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
