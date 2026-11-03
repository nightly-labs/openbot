// A minimal protobuf wire encoder and decoder. It supports only what the Signal messages and the
// stored records use: `uint32` varints (wire type 0) and length-delimited bytes (wire type 2).
// The decoder skips unknown 64-bit and 32-bit fields.

const VARINT = 0;
const FIXED64 = 1;
const LENGTH_DELIMITED = 2;
const FIXED32 = 5;
const UINT32_RANGE = 2 ** 32;

/** Writes fields in the order of the calls. */
export class ProtoWriter {
  readonly #chunks: number[] = [];

  uint32(field: number, value: number): this {
    if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
      throw new Error(`Protobuf field ${field}: ${value} is not a uint32`);
    }
    this.#varint(field * 8 + VARINT);
    this.#varint(value);
    return this;
  }

  bytes(field: number, value: Uint8Array): this {
    this.#varint(field * 8 + LENGTH_DELIMITED);
    this.#varint(value.length);
    for (const byte of value) this.#chunks.push(byte);
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.#chunks);
  }

  #varint(value: number): void {
    let rest = value;
    while (rest >= 0x80) {
      this.#chunks.push((rest % 0x80) | 0x80);
      rest = Math.floor(rest / 0x80);
    }
    this.#chunks.push(rest);
  }
}

/** The fields of one decoded message, by field number, in wire order. */
export class ProtoFields {
  readonly #fields = new Map<number, Array<number | Uint8Array>>();

  constructor(buffer: Uint8Array) {
    let offset = 0;
    const readVarint = (): number => {
      let result = 0;
      let scale = 1;
      for (let i = 0; i < 10; i++) {
        if (offset >= buffer.length) throw new Error("Protobuf: truncated varint");
        const byte = buffer[offset++] ?? 0;
        result += (byte & 0x7f) * scale;
        if ((byte & 0x80) === 0) return result;
        scale *= 0x80;
      }
      throw new Error("Protobuf: varint too long");
    };
    while (offset < buffer.length) {
      const tag = readVarint();
      const field = Math.floor(tag / 8);
      const wireType = tag % 8;
      if (field === 0) throw new Error("Protobuf: field number 0");
      let value: number | Uint8Array;
      if (wireType === VARINT) {
        // A uint32 parser keeps the low 32 bits of a longer varint.
        value = readVarint() % UINT32_RANGE;
      } else if (wireType === LENGTH_DELIMITED) {
        const length = readVarint();
        if (offset + length > buffer.length) throw new Error("Protobuf: truncated bytes field");
        value = buffer.slice(offset, offset + length);
        offset += length;
      } else if (wireType === FIXED64 || wireType === FIXED32) {
        offset += wireType === FIXED64 ? 8 : 4;
        if (offset > buffer.length) throw new Error("Protobuf: truncated fixed field");
        continue;
      } else {
        throw new Error(`Protobuf: unsupported wire type ${wireType}`);
      }
      const list = this.#fields.get(field);
      if (list) list.push(value);
      else this.#fields.set(field, [value]);
    }
  }

  /** The last value of a `uint32` field, as protobuf parsers do for repeated scalars. */
  uint32(field: number): number | undefined {
    const value = this.#fields.get(field)?.at(-1);
    if (value === undefined) return undefined;
    if (typeof value !== "number") throw new Error(`Protobuf field ${field}: expected a varint`);
    return value;
  }

  bytes(field: number): Uint8Array | undefined {
    const value = this.#fields.get(field)?.at(-1);
    if (value === undefined) return undefined;
    if (typeof value === "number") throw new Error(`Protobuf field ${field}: expected bytes`);
    return value;
  }

  repeatedBytes(field: number): Uint8Array[] {
    return (this.#fields.get(field) ?? []).map((value) => {
      if (typeof value === "number") throw new Error(`Protobuf field ${field}: expected bytes`);
      return value;
    });
  }

  requireUint32(field: number, name: string): number {
    const value = this.uint32(field);
    if (value === undefined) throw new Error(`Protobuf: missing ${name}`);
    return value;
  }

  requireBytes(field: number, name: string): Uint8Array {
    const value = this.bytes(field);
    if (value === undefined) throw new Error(`Protobuf: missing ${name}`);
    return value;
  }
}
