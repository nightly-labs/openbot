export interface ElfSearchPath {
  readonly offset: number;
  readonly value: string;
}

export const ORIGIN_SEARCH_PATH = "$ORIGIN";

const SHT_DYNAMIC = 6;
const DT_NULL = 0n;
const DT_RPATH = 15n;
const DT_RUNPATH = 29n;

export function elfSearchPaths(file: Buffer): ElfSearchPath[] {
  if (file.toString("binary", 0, 4) !== "\x7fELF" || file[4] !== 2 || file[5] !== 1) {
    throw new Error("Expected a 64-bit little-endian ELF file.");
  }
  const sectionTable = Number(file.readBigUInt64LE(0x28));
  const sectionHeaderSize = file.readUInt16LE(0x3a);
  const sectionCount = file.readUInt16LE(0x3c);
  const sectionHeader = (index: number) => sectionTable + index * sectionHeaderSize;
  const paths: ElfSearchPath[] = [];
  for (let index = 0; index < sectionCount; index++) {
    const header = sectionHeader(index);
    if (file.readUInt32LE(header + 4) !== SHT_DYNAMIC) continue;
    const start = Number(file.readBigUInt64LE(header + 0x18));
    const end = start + Number(file.readBigUInt64LE(header + 0x20));
    const strings = Number(file.readBigUInt64LE(sectionHeader(file.readUInt32LE(header + 0x28)) + 0x18));
    for (let entry = start; entry < end; entry += 16) {
      const tag = file.readBigInt64LE(entry);
      if (tag === DT_NULL) break;
      if (tag !== DT_RPATH && tag !== DT_RUNPATH) continue;
      const offset = strings + Number(file.readBigUInt64LE(entry + 8));
      paths.push({ offset, value: file.toString("utf8", offset, file.indexOf(0, offset)) });
    }
  }
  return paths;
}
