// Makes one TURN allocation over TLS, as a browser does for `turns:<relay>:<port>`, and frees it
// again. It sends the relay name as SNI, so it checks the nginx route of README "TURN on port 443".
// Run it on the Signal machine, inside the Signal container, so the secret stays there:
//
//   docker exec -i openbot-remote-remote-api-1 sh -c 'cd /app/remote/api && bun -e "$(cat)" <relay> [port] [address]' < remote/scripts/turn-tls-probe.ts
//
// It never prints the secret or the credentials.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { connect, type TLSSocket } from "node:tls";

const MAGIC_COOKIE = 0x2112a442;
const ALLOCATE = 0x0003;
const REFRESH = 0x0004;
const ALLOCATE_SUCCESS = 0x0103;
const REFRESH_SUCCESS = 0x0104;
const USERNAME = 0x0006;
const MESSAGE_INTEGRITY = 0x0008;
const ERROR_CODE = 0x0009;
const LIFETIME = 0x000d;
const REALM = 0x0014;
const NONCE = 0x0015;
const REQUESTED_TRANSPORT = 0x0019;
const UDP_PROTOCOL = 17;

// `bun -e` puts the arguments right after `bun`; `bun <file>` puts the file first.
const args = process.argv.slice(process.argv[1]?.endsWith("turn-tls-probe.ts") ? 2 : 1);
const relay = args[0];
const port = Number(args[1] ?? 443);
const address = args[2] ?? relay;
const secret = process.env.TURN_SHARED_SECRET;
if (!relay || !address || !Number.isInteger(port) || !secret) {
  console.error("Usage: turn-tls-probe.ts <relay> [port] [address], with TURN_SHARED_SECRET set.");
  process.exit(2);
}

const username = `${Math.floor(Date.now() / 1_000) + 60}:openbot-tls-probe`;
const password = createHmac("sha1", secret).update(username).digest("base64");

function attribute(type: number, value: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(value.length, 2);
  return Buffer.concat([header, value, Buffer.alloc((4 - (value.length % 4)) % 4)]);
}

function message(type: number, attributes: Buffer[], key?: Buffer): Buffer {
  let body = Buffer.concat(attributes);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt32BE(MAGIC_COOKIE, 4);
  randomBytes(12).copy(header, 8);
  if (key) {
    // MESSAGE-INTEGRITY covers the header with a length that already counts its own 24 bytes.
    header.writeUInt16BE(body.length + 24, 2);
    const mac = createHmac("sha1", key)
      .update(Buffer.concat([header, body]))
      .digest();
    body = Buffer.concat([body, attribute(MESSAGE_INTEGRITY, mac)]);
  }
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

function parse(data: Buffer): { type: number; attributes: Map<number, Buffer> } {
  const attributes = new Map<number, Buffer>();
  const end = 20 + data.readUInt16BE(2);
  for (let offset = 20; offset + 4 <= end; ) {
    const type = data.readUInt16BE(offset);
    const length = data.readUInt16BE(offset + 2);
    attributes.set(type, data.subarray(offset + 4, offset + 4 + length));
    offset += 4 + length + ((4 - (length % 4)) % 4);
  }
  return { type: data.readUInt16BE(0), attributes };
}

function errorCode(response: { attributes: Map<number, Buffer> }): string {
  const value = response.attributes.get(ERROR_CODE);
  return value && value.length >= 4 ? String((value[2] ?? 0) * 100 + (value[3] ?? 0)) : "none";
}

const transport = attribute(REQUESTED_TRANSPORT, Buffer.from([UDP_PROTOCOL, 0, 0, 0]));
let step: "challenge" | "allocate" | "refresh" = "challenge";
let auth: Buffer[] = [];
let key = Buffer.alloc(0);

const socket: TLSSocket = connect({ host: address, port, servername: relay }, () => {
  socket.write(message(ALLOCATE, [transport]));
});
socket.setTimeout(10_000, () => fail(`no answer at step ${step}`));
socket.on("error", (error) => fail(error.message));
socket.on("data", (data: Buffer) => {
  if (data.length < 20 || data.readUInt32BE(4) !== MAGIC_COOKIE) {
    fail(`the answer is not STUN, so ${relay}:${port} does not reach coturn`);
  }
  const response = parse(data);
  if (step === "challenge") {
    const realm = response.attributes.get(REALM);
    const nonce = response.attributes.get(NONCE);
    if (!realm || !nonce) fail(`no realm or nonce, error ${errorCode(response)}`);
    key = createHash("md5").update(`${username}:${realm}:${password}`).digest();
    auth = [attribute(USERNAME, Buffer.from(username)), attribute(REALM, realm), attribute(NONCE, nonce)];
    step = "allocate";
    socket.write(message(ALLOCATE, [transport, ...auth], key));
  } else if (step === "allocate") {
    if (response.type !== ALLOCATE_SUCCESS) fail(`Allocate refused, error ${errorCode(response)}`);
    console.log(`Allocate over TLS on ${relay}:${port}: success`);
    step = "refresh";
    socket.write(message(REFRESH, [attribute(LIFETIME, Buffer.alloc(4)), ...auth], key));
  } else {
    console.log(response.type === REFRESH_SUCCESS ? "Allocation freed." : `Free refused, error ${errorCode(response)}`);
    socket.destroy();
  }
});

function fail(reason: string): never {
  console.error(`TURN TLS probe failed: ${reason}.`);
  socket.destroy();
  process.exit(1);
}
