/**
 * Opens the props that the host sealed with `sealLiveActivity` from `@openbot/team-client`, or
 * returns `null` when the tag does not match. The keys are base64url text.
 *
 * The widget extension runs it in a bare JavaScript context with no crypto library. The `widget`
 * directive turns it into a string, so it uses nothing from outside its body, and it has its own
 * SHA-256. Its test opens what the host module seals.
 */
export function openSealedLiveActivity(sealed: string, sealKey: string, tagKey: string): string | null {
  "widget";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const decode = (value: string): number[] | null => {
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (let index = 0; index < value.length; index += 1) {
      const digit = alphabet.indexOf(value.charAt(index));
      if (digit < 0) return null;
      buffer = ((buffer << 6) | digit) & 0xffffff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return bytes;
  };
  const rounds = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ];
  const rotate = (value: number, count: number) => (value >>> count) | (value << (32 - count));
  const sha256 = (message: number[]): number[] => {
    const data = message.slice();
    const length = message.length * 8;
    data.push(0x80);
    while (data.length % 64 !== 56) data.push(0);
    for (let shift = 56; shift >= 0; shift -= 8) data.push(shift >= 32 ? 0 : (length >>> shift) & 0xff);
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const words: number[] = [];
    for (let block = 0; block < data.length; block += 64) {
      for (let index = 0; index < 64; index += 1) {
        if (index < 16) {
          const at = block + index * 4;
          words[index] =
            (((data[at] ?? 0) << 24) |
              ((data[at + 1] ?? 0) << 16) |
              ((data[at + 2] ?? 0) << 8) |
              (data[at + 3] ?? 0)) >>>
            0;
        } else {
          const early = words[index - 15] ?? 0;
          const late = words[index - 2] ?? 0;
          const small0 = rotate(early, 7) ^ rotate(early, 18) ^ (early >>> 3);
          const small1 = rotate(late, 17) ^ rotate(late, 19) ^ (late >>> 10);
          words[index] = ((words[index - 16] ?? 0) + small0 + (words[index - 7] ?? 0) + small1) >>> 0;
        }
      }
      let [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = hash;
      for (let index = 0; index < 64; index += 1) {
        const big1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        const choose = (e & f) ^ (~e & g);
        const first = (h + big1 + choose + (rounds[index] ?? 0) + (words[index] ?? 0)) >>> 0;
        const big0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const second = (big0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + first) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (first + second) >>> 0;
      }
      const next = [a, b, c, d, e, f, g, h];
      for (let index = 0; index < 8; index += 1) hash[index] = ((hash[index] ?? 0) + (next[index] ?? 0)) >>> 0;
    }
    const out: number[] = [];
    for (const word of hash) out.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
    return out;
  };
  const hmac = (key: number[], message: number[]): number[] => {
    const block = key.length > 64 ? sha256(key) : key.slice();
    while (block.length < 64) block.push(0);
    const inner = sha256(block.map((byte) => byte ^ 0x36).concat(message));
    return sha256(block.map((byte) => byte ^ 0x5c).concat(inner));
  };

  const nonceBytes = 16;
  const tagBytes = 16;
  const bytes = decode(sealed);
  const seal = decode(sealKey);
  const tag = decode(tagKey);
  if (!bytes || !seal || !tag || bytes.length < nonceBytes + tagBytes) return null;
  const body = bytes.slice(0, bytes.length - tagBytes);
  const expected = hmac(tag, body);
  let difference = 0;
  for (let index = 0; index < tagBytes; index += 1) {
    difference |= (expected[index] ?? 0) ^ (bytes[body.length + index] ?? 0);
  }
  if (difference !== 0) return null;
  const nonce = body.slice(0, nonceBytes);
  const cipher = body.slice(nonceBytes);
  let escaped = "";
  for (let offset = 0; offset < cipher.length; offset += 32) {
    const block = offset / 32;
    const stream = hmac(
      seal,
      nonce.concat([(block >>> 24) & 0xff, (block >>> 16) & 0xff, (block >>> 8) & 0xff, block & 0xff]),
    );
    for (let index = 0; index < 32 && offset + index < cipher.length; index += 1) {
      const byte = (cipher[offset + index] ?? 0) ^ (stream[index] ?? 0);
      escaped += `%${byte < 16 ? "0" : ""}${byte.toString(16)}`;
    }
  }
  try {
    return decodeURIComponent(escaped);
  } catch {
    return null;
  }
}
