import { createCipheriv, createHash, createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { z } from "zod";

export const B2_HOST = "s3.eu-central-003.backblazeb2.com";
const B2_REGION = "eu-central-003";
export const B2_BUCKET = "openbot-pool-archive-eu";
export const ARCHIVE_REGION = "eu";
export const PART_BYTES = 100 * 1024 * 1024;
export const UPLOAD_URL_SECONDS = 6 * 60 * 60;
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const WRAP_VERSION = "v1";

export interface B2Key {
  id: string;
  secret: string;
}

export interface UploadedPart {
  number: number;
  size: number;
  md5: string;
  etag: string;
}

export const archiveScript = (machineHosting: string) => `
set -euo pipefail
recipient=$1 part_bytes=$2
dir=$(mktemp -d /var/tmp/openbot-archive.XXXXXX)
trap 'rm -rf "$dir"' EXIT
cat >"$dir/urls"
cat >"$dir/part.sh" <<'PART'
set -euo pipefail
number=$((10#\${FILE##*.} + 1))
url=$(sed -n "\${number}p" "$URLS")
[ -n "$url" ] || { echo "No upload URL for part $number." >&2; exit 3; }
cat >"$FILE"
size=$(stat -c %s "$FILE")
md5=$(md5sum "$FILE" | cut -c1-32)
etag=$(curl -fsS --retry 5 --retry-all-errors -T "$FILE" -D - -o /dev/null "$url" | tr -d '\\r"' | sed -n 's/^[Ee][Tt][Aa][Gg]: *//p')
rm -f "$FILE"
echo "part $number $size $md5 $etag"
PART
mkfifo "$dir/sum"
sha256sum <"$dir/sum" | cut -c1-64 >"$dir/sha256" &
summer=$!
export URLS="$dir/urls"
bash ${machineHosting}/move-from-boat.sh export - | age -r "$recipient" | tee "$dir/sum" |
  split -b "$part_bytes" -d -a 5 --filter="bash $dir/part.sh" - "$dir/part."
wait "$summer"
echo "sha256 $(cat "$dir/sha256")"
`;

export function shellWord(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function uploadedParts(output: string) {
  const parts: UploadedPart[] = output
    .split("\n")
    .filter((line) => line.startsWith("part "))
    .map((line) => {
      const [, number = "", size = "", md5 = "", etag = ""] = line.split(" ");
      return { number: Number(number), size: Number(size), md5, etag };
    });
  const sha256 = /^sha256 ([0-9a-f]{64})$/mu.exec(output)?.[1] ?? "";
  return { parts, sha256, bytes: parts.reduce((total, part) => total + part.size, 0) };
}

export function partCount(serverBytes: number) {
  return Math.ceil((serverBytes * 1.05 + 256 * 1024 * 1024) / PART_BYTES) + 1;
}

function bech32Polymod(values: number[]) {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (const [bit, generator] of BECH32_GENERATOR.entries()) {
      if ((top >>> bit) & 1) checksum ^= generator;
    }
  }
  return checksum;
}

function bech32(prefix: string, data: Buffer) {
  const words: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const byte of data) {
    accumulator = ((accumulator << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((accumulator >>> bits) & 31);
    }
  }
  if (bits > 0) words.push((accumulator << (5 - bits)) & 31);
  const codes = [...prefix].map((character) => character.charCodeAt(0));
  const expanded = [...codes.map((code) => code >>> 5), 0, ...codes.map((code) => code & 31)];
  const mod = bech32Polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, index) => (mod >>> (5 * (5 - index))) & 31);
  return `${prefix}1${[...words, ...checksum].map((word) => BECH32_CHARSET.charAt(word)).join("")}`;
}

export function newArchiveKey() {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const secret = z.object({ d: z.string() }).parse(privateKey.export({ format: "jwk" })).d;
  const shared = z.object({ x: z.string() }).parse(publicKey.export({ format: "jwk" })).x;
  return {
    identity: bech32("age-secret-key-", Buffer.from(secret, "base64url")).toUpperCase(),
    recipient: bech32("age", Buffer.from(shared, "base64url")),
  };
}

export function wrapKeySecret(value: string | undefined) {
  const secret = Buffer.from(value ?? "", "base64");
  if (secret.length !== 32) throw new Error("HOSTED_ARCHIVE_KEY_SECRET is not 32 bytes in base64.");
  return secret;
}

export function wrapArchiveKey(secret: Buffer, identity: string, serverId: string, objectKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  cipher.setAAD(Buffer.from(`${serverId}\n${objectKey}`, "utf8"));
  const sealed = Buffer.concat([cipher.update(identity, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${WRAP_VERSION}.${iv.toString("base64url")}.${sealed.toString("base64url")}`;
}

function uriPart(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function presign(
  b2: B2Key,
  method: string,
  objectKey: string,
  parameters: Record<string, string>,
  seconds: number,
) {
  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/gu, "");
  const day = now.slice(0, 8);
  const scope = `${day}/${B2_REGION}/s3/aws4_request`;
  const query = Object.entries({
    ...parameters,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${b2.id}/${scope}`,
    "X-Amz-Date": now,
    "X-Amz-Expires": String(seconds),
    "X-Amz-SignedHeaders": "host",
  })
    .map(([name, value]) => `${uriPart(name)}=${uriPart(value)}`)
    .sort()
    .join("&");
  const path = `/${B2_BUCKET}/${objectKey.split("/").map(uriPart).join("/")}`;
  const request = [method, path, query, `host:${B2_HOST}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const text = ["AWS4-HMAC-SHA256", now, scope, createHash("sha256").update(request).digest("hex")].join("\n");
  const signingKey = [day, B2_REGION, "s3", "aws4_request"].reduce<Buffer>(
    (key, part) => createHmac("sha256", key).update(part).digest(),
    Buffer.from(`AWS4${b2.secret}`),
  );
  const signature = createHmac("sha256", signingKey).update(text).digest("hex");
  return `https://${B2_HOST}${path}?${query}&X-Amz-Signature=${signature}`;
}

export async function b2Request(
  b2: B2Key,
  method: string,
  objectKey: string,
  parameters: Record<string, string>,
  body?: string,
) {
  const response = await fetch(presign(b2, method, objectKey, parameters, 900), {
    method,
    body: body ?? null,
    signal: AbortSignal.timeout(120_000),
  });
  const text = method === "HEAD" ? "" : await response.text();
  return { status: response.status, headers: response.headers, text };
}

export async function startUpload(b2: B2Key, objectKey: string) {
  const created = await b2Request(b2, "POST", objectKey, { uploads: "" });
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/u.exec(created.text)?.[1] ?? "";
  if (created.status !== 200 || uploadId === "") throw new Error(`B2 did not start the upload: ${created.status}.`);
  return uploadId;
}

export function partUrls(b2: B2Key, objectKey: string, uploadId: string, count: number) {
  return Array.from({ length: count }, (_, index) =>
    presign(b2, "PUT", objectKey, { partNumber: String(index + 1), uploadId }, UPLOAD_URL_SECONDS),
  ).join("\n");
}

export async function completeUpload(b2: B2Key, objectKey: string, uploadId: string, parts: UploadedPart[]) {
  const body = `<CompleteMultipartUpload>${parts
    .map((part) => `<Part><PartNumber>${part.number}</PartNumber><ETag>"${part.etag}"</ETag></Part>`)
    .join("")}</CompleteMultipartUpload>`;
  const done = await b2Request(b2, "POST", objectKey, { uploadId }, body);
  if (done.status !== 200 || done.text.includes("<Error>")) {
    throw new Error(`B2 did not complete the upload: ${done.status}.`);
  }
  const head = await b2Request(b2, "HEAD", objectKey, {});
  return {
    status: head.status,
    versionId: head.headers.get("x-amz-version-id") ?? "",
    size: Number(head.headers.get("content-length") ?? "0"),
  };
}

export async function abortUpload(b2: B2Key, objectKey: string, uploadId: string) {
  await b2Request(b2, "DELETE", objectKey, { uploadId }).catch(() => undefined);
}

export async function deleteArchive(b2: B2Key, objectKey: string, versionId: string) {
  const answer = await b2Request(b2, "DELETE", objectKey, versionId === "" ? {} : { versionId });
  const head = await b2Request(b2, "HEAD", objectKey, {});
  return { deleted: (answer.status === 204 || answer.status === 404) && head.status === 404, status: answer.status };
}
