import { describe, expect, it } from "vitest";
import { fontDirectories, fontFamilies } from "./installed-fonts";

function utf16be(text: string): Buffer {
  const bytes = Buffer.alloc(text.length * 2);
  for (let index = 0; index < text.length; index += 1) bytes.writeUInt16BE(text.charCodeAt(index), index * 2);
  return bytes;
}

interface FaceName {
  nameId: number;
  text: string;
  platformId?: number;
  languageId?: number;
}

/** A font file with one face and only the name table that the reader needs. */
function fontFile(names: FaceName[], collection = false): Buffer {
  const strings = names.map((name) => utf16be(name.text));
  const recordCount = names.length;
  const storageOffset = 6 + recordCount * 12;
  const nameTable = Buffer.alloc(storageOffset + strings.reduce((total, bytes) => total + bytes.length, 0));
  nameTable.writeUInt16BE(0, 0);
  nameTable.writeUInt16BE(recordCount, 2);
  nameTable.writeUInt16BE(storageOffset, 4);
  let stringOffset = 0;
  names.forEach((name, index) => {
    const record = 6 + index * 12;
    const bytes = strings[index];
    if (bytes === undefined) return;
    nameTable.writeUInt16BE(name.platformId ?? 3, record);
    nameTable.writeUInt16BE(1, record + 2);
    nameTable.writeUInt16BE(name.languageId ?? 0x0409, record + 4);
    nameTable.writeUInt16BE(name.nameId, record + 6);
    nameTable.writeUInt16BE(bytes.length, record + 8);
    nameTable.writeUInt16BE(stringOffset, record + 10);
    bytes.copy(nameTable, storageOffset + stringOffset);
    stringOffset += bytes.length;
  });
  const face = Buffer.alloc(28 + nameTable.length);
  face.writeUInt32BE(0x00010000, 0);
  face.writeUInt16BE(1, 4);
  face.write("name", 12, "latin1");
  // A collection's table offsets start at the file, not at the face.
  face.writeUInt32BE(collection ? 48 : 28, 20);
  face.writeUInt32BE(nameTable.length, 24);
  nameTable.copy(face, 28);
  if (!collection) return face;
  const collectionHeader = Buffer.alloc(20);
  collectionHeader.write("ttcf", 0, "latin1");
  collectionHeader.writeUInt32BE(1, 8);
  collectionHeader.writeUInt32BE(20, 12);
  return Buffer.concat([collectionHeader, face]);
}

const source = (buffer: Buffer) => ({
  size: buffer.length,
  read: async (offset: number, length: number) => buffer.subarray(offset, Math.min(offset + length, buffer.length)),
});

describe("installed fonts", () => {
  it("reads the family of a face and prefers the typographic family", async () => {
    const buffer = fontFile([
      { nameId: 1, text: "Vazirmatn" },
      { nameId: 16, text: "Vazirmatn Variable" },
    ]);
    expect(await fontFamilies(source(buffer))).toEqual(["Vazirmatn Variable"]);
  });

  it("reads a face in a font collection", async () => {
    const buffer = fontFile([{ nameId: 1, text: "Geeza Pro" }], true);
    expect(await fontFamilies(source(buffer))).toEqual(["Geeza Pro"]);
  });

  it("drops a hidden system face", async () => {
    const buffer = fontFile([{ nameId: 1, text: ".SF NS" }]);
    expect(await fontFamilies(source(buffer))).toEqual([]);
  });

  it("gives no name for a file that is not a font", async () => {
    expect(await fontFamilies(source(Buffer.from("not a font at all")))).toEqual([]);
  });

  it("reads the folders of each platform", () => {
    expect(fontDirectories("darwin", "/Users/someone")).toContain("/System/Library/Fonts");
    expect(fontDirectories("darwin", "/Users/someone")).toContain("/Users/someone/Library/Fonts");
    expect(fontDirectories("linux", "/home/someone")).toContain("/usr/share/fonts");
    expect(fontDirectories("linux", "/home/someone")).toContain("/home/someone/.local/share/fonts");
    expect(fontDirectories("win32", "C:\\Users\\someone").some((path) => path.endsWith("Fonts"))).toBe(true);
    expect(fontDirectories("aix", "/home/someone")).toEqual([]);
  });
});
