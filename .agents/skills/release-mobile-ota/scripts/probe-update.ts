import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    platform: { type: "string" },
    runtime: { type: "string" },
    update: { type: "string" },
    rollout: { type: "string", default: "100" },
    channel: { type: "string", default: "production" },
    server: { type: "string", default: "https://updates.openbot.run" },
  },
});

const platform = values.platform;
const runtime = values.runtime;
const updateId = values.update?.toLowerCase();
const rollout = Number(values.rollout);
if ((platform !== "ios" && platform !== "android") || !runtime || !updateId || !(rollout >= 1 && rollout <= 100)) {
  console.error(
    "Usage: bun probe-update.ts --platform ios|android --runtime <runtime version> --update <update ID> [--rollout 1-100] [--channel production]",
  );
  process.exit(2);
}

async function rolloutBucket(clientId: string): Promise<number> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${updateId}:${clientId}`));
  return new DataView(digest).getUint32(0) % 100;
}

async function clientWhere(inside: boolean): Promise<string> {
  for (;;) {
    const clientId = crypto.randomUUID();
    if ((await rolloutBucket(clientId)) < rollout === inside) return clientId;
  }
}

async function askManifest(clientId: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${values.server}/manifest`, {
    headers: {
      accept: "multipart/mixed",
      "expo-platform": platform ?? "",
      "expo-protocol-version": "1",
      "expo-runtime-version": runtime ?? "",
      "expo-channel-name": values.channel ?? "production",
      "eas-client-id": clientId,
      "expo-current-update-id": "00000000-0000-4000-8000-000000000000",
      "expo-embedded-update-id": "00000000-0000-4000-8000-000000000001",
      "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"',
    },
  });
  return { status: response.status, body: response.status === 200 ? await response.text() : "" };
}

const failures: string[] = [];
const inside = await askManifest(await clientWhere(true));
const servedId = inside.body.match(/"id"\s*:\s*"([0-9a-f-]{36})"/u)?.[1]?.toLowerCase() ?? null;
const signed = /expo-signature/iu.test(inside.body);
if (inside.status !== 200) failures.push(`A phone in the rollout got HTTP ${inside.status}, not the update.`);
else if (servedId !== updateId) failures.push(`A phone in the rollout got update ${servedId}, not ${updateId}.`);
if (inside.status === 200 && !signed) failures.push("The manifest has no signature.");

let outsideStatus: number | null = null;
if (rollout < 100) {
  const outside = await askManifest(await clientWhere(false));
  outsideStatus = outside.status;
  const outsideId = outside.body.match(/"id"\s*:\s*"([0-9a-f-]{36})"/u)?.[1]?.toLowerCase() ?? null;
  if (outsideId === updateId) failures.push("A phone outside the rollout got the update.");
}

const assetUrls = [...new Set([...inside.body.matchAll(/"url"\s*:\s*"([^"]+)"/gu)].map((match) => match[1] ?? ""))].filter(
  (url) => url !== "" && !url.endsWith("/manifest"),
);
let assetsOk = 0;
for (const url of assetUrls) {
  const response = await fetch(url);
  await response.arrayBuffer();
  if (response.ok) assetsOk += 1;
  else failures.push(`Asset HTTP ${response.status}: ${url}`);
}
if (inside.status === 200 && assetUrls.length === 0) failures.push("The manifest names no asset.");

console.log(
  JSON.stringify(
    {
      platform,
      runtime,
      update: updateId,
      rollout,
      insideStatus: inside.status,
      servedId,
      signed,
      outsideStatus,
      assets: { ok: assetsOk, total: assetUrls.length },
      failures,
    },
    null,
    2,
  ),
);
process.exit(failures.length === 0 ? 0 : 1);
