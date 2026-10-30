// OPENBOT PATCH: the LT-hash came from whatsapp-rust-bridge, which compiles AGPL-3.0 code. This is the
// JavaScript LT-hash of Baileys 6.7.24 (MIT), made synchronous over node:crypto HKDF.
import { hkdf } from './crypto'

/**
 * LT Hash is a summation based hash algorithm that maintains the integrity of a piece of data
 * over a series of mutations. You can add/remove mutations and it'll return a hash equal to
 * if the same series of mutations was made sequentially.
 */
const EXPANDED_LENGTH = 128

class LTHash {
	constructor(private readonly salt: string) {}

	subtractThenAdd(base: Uint8Array, subtract: Uint8Array[], add: Uint8Array[]): Uint8Array {
		let result: Uint8Array = Uint8Array.from(base)
		for (const item of subtract) result = this.pointwise(result, item, (a, b) => a - b)
		for (const item of add) result = this.pointwise(result, item, (a, b) => a + b)
		return result
	}

	private pointwise(base: Uint8Array, item: Uint8Array, op: (a: number, b: number) => number): Uint8Array {
		const derived = hkdf(item, EXPANDED_LENGTH, { info: this.salt })
		const left = new DataView(base.buffer, base.byteOffset, base.byteLength)
		const right = new DataView(derived.buffer, derived.byteOffset, derived.byteLength)
		const out = new Uint8Array(base.byteLength)
		const view = new DataView(out.buffer)
		for (let offset = 0; offset < base.byteLength; offset += 2) {
			view.setUint16(offset, op(left.getUint16(offset, true), right.getUint16(offset, true)), true)
		}
		return out
	}
}

export const LT_HASH_ANTI_TAMPERING = new LTHash('WhatsApp Patch Integrity')
