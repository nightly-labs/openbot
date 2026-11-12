// Runs the update server of the mobile app (the real Worker code on a local R2 bucket, workerd
// through Wrangler) and the real publish commands, then asks for updates as a phone does. It checks:
//
// - a binary with no update gets the empty answer, and bad requests are refused;
// - a published update comes back signed, the certificate accepts the signature, and each file that
//   the manifest names downloads with the hash that the manifest gives;
// - a part rollout reaches a stable part of the installs and the others keep the earlier update;
// - an update that failed on a phone is not sent to it again;
// - a rollback publishes the earlier bundle again as a newer update, and a second rollback sends a
//   signed directive that returns phones to the bundle in their binary;
// - a publish with a key that the certificate does not accept changes nothing;
// - a manifest that someone changes in the bucket no longer has a valid signature;
// - other runtime versions and channels are not affected, and the answers come from the cache;
// - a rollout change and a rollback find the binary that has an update from the store builds, also
//   when only one platform has an update, and stop when two store versions have one;
// - no `.gitignore` file ignores the update signing certificate by itself, so the project copy of
//   the EAS build has it;
// - the publish guard of `scripts/mobile-ota.ts` passes a commit whose runtime version a store build
//   has, and refuses one that no store build has.
//
// Run: bun run test:mobile-ota
// It writes .openbot-build/mobile-ota-e2e/report.json and exits non-zero on a failure. The bucket
// and the keys are in a temporary directory. It uses no network.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { getPlatformProxy } from "wrangler";
import {
  changeRollout,
  fingerprint,
  liveUpdateScopes,
  multipartParts,
  publishUpdate,
  readExport,
  readPointer,
  rollBack,
  type SigningKeys,
  type StoreBuild,
  storeBuildTag,
  type UpdateScope,
  type UpdateStore,
  verifySignature,
} from "../../../scripts/mobile-ota-lib";
import { type MobileUpdatesRuntime, routeRequest, type UpdateObject } from "../src/index";
import { pointerKey, updateKey } from "../src/protocol";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "mobile-ota-e2e");
const MOBILE = join(ROOT, "apps", "mobile");
const BIN = join(ROOT, "node_modules", ".bin");
const SERVER = "https://updates.test";
const EMBEDDED_ID = "11111111-1111-4111-8111-111111111111";

const steps: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  steps.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

const temp = await mkdtemp(join(tmpdir(), "openbot-mobile-ota-e2e-"));
const proxy = await getPlatformProxy<{ UPDATES: R2Bucket }>({
  configPath: join(ROOT, "apps", "mobile-updates", "wrangler.jsonc"),
  persist: { path: join(temp, "state") },
  envFiles: [],
});

try {
  const bucket = proxy.env.UPDATES;
  let bucketReads = 0;
  const env = {
    UPDATES: {
      get: async (key: string): Promise<UpdateObject | null> => {
        bucketReads += 1;
        const object = await bucket.get(key);
        if (!object) return null;
        // Under Bun, the local bucket cannot stream a body, so the script reads the whole object.
        const bytes = await object.arrayBuffer();
        return {
          body: new Blob([bytes]).stream(),
          size: object.size,
          httpEtag: object.httpEtag,
          httpMetadata: object.httpMetadata,
          text: async () => new TextDecoder().decode(bytes),
        };
      },
    },
  };
  const store: UpdateStore = {
    read: async (key) => (await (await bucket.get(key))?.text()) ?? null,
    exists: async (key) => (await bucket.head(key)) !== null,
    write: async (key, body, contentType) => {
      await bucket.put(key, body, { httpMetadata: { contentType } });
    },
  };

  // The Cache API of one Worker location: the Worker keeps bucket answers in it.
  const cached = new Map<string, Response>();
  const pending: Promise<void>[] = [];
  const runtime: MobileUpdatesRuntime = {
    cache: {
      match: async (request) => cached.get(new Request(request).url)?.clone(),
      put: async (request, response) => {
        cached.set(new Request(request).url, response);
      },
    },
    schedule: (work) => {
      pending.push(Effect.runPromise(work));
    },
  };
  /** One request to the Worker. `fresh` asks as a location that has nothing in its cache. */
  async function request(path: string, init: RequestInit = {}, fresh = true): Promise<Response> {
    if (fresh) cached.clear();
    const response = await Effect.runPromise(routeRequest(new Request(`${SERVER}${path}`, init), env, runtime));
    await Promise.all(pending.splice(0));
    return response;
  }

  // The same command that makes the production keys.
  await run(
    join(BIN, "expo-updates"),
    [
      "codesigning:generate",
      "--key-output-directory",
      join(temp, "keys"),
      "--certificate-output-directory",
      join(temp, "certs"),
      "--certificate-validity-duration-years",
      "1",
      "--certificate-common-name",
      "OpenBot OTA E2E",
    ],
    { cwd: MOBILE },
  );
  const keys: SigningKeys = {
    privateKeyPem: await readFile(join(temp, "keys", "private-key.pem"), "utf8"),
    certificatePem: await readFile(join(temp, "certs", "certificate.pem"), "utf8"),
  };

  /** A folder as `expo export` writes it, with one bundle and two assets for each platform. */
  async function writeExport(name: string, bundleText: string): Promise<string> {
    const directory = join(temp, name);
    const image = Buffer.from(`image of ${name}`);
    const page = Buffer.from(`<html>${name}</html>`);
    const imagePath = join("assets", createHash("md5").update(image).digest("hex"));
    const pagePath = join("www.bundle", `${createHash("md5").update(page).digest("hex")}.html`);
    await mkdir(join(directory, "assets"), { recursive: true });
    await mkdir(join(directory, "www.bundle"), { recursive: true });
    await mkdir(join(directory, "_expo", "static", "js", "ios"), { recursive: true });
    await mkdir(join(directory, "_expo", "static", "js", "android"), { recursive: true });
    await writeFile(join(directory, imagePath), image);
    await writeFile(join(directory, pagePath), page);
    const fileMetadata: { [platform: string]: object } = {};
    for (const platform of ["ios", "android"]) {
      const bundle = join("_expo", "static", "js", platform, "entry.hbc");
      await writeFile(join(directory, bundle), `${bundleText} for ${platform}`);
      fileMetadata[platform] = {
        bundle,
        assets: [
          { path: imagePath, ext: "png" },
          { path: pagePath, ext: "html" },
        ],
      };
    }
    await writeFile(join(directory, "metadata.json"), JSON.stringify({ version: 0, bundler: "metro", fileMetadata }));
    return directory;
  }

  const scope: UpdateScope = { channel: "production", platform: "ios", runtimeVersion: "runtime-a" };
  function phone(extra: HeadersInit = {}, of: UpdateScope = scope): RequestInit {
    return {
      headers: {
        accept: "multipart/mixed,application/expo+json,application/json",
        "expo-platform": of.platform,
        "expo-protocol-version": "1",
        "expo-runtime-version": of.runtimeVersion,
        "expo-channel-name": of.channel,
        "expo-embedded-update-id": EMBEDDED_ID,
        "expo-current-update-id": EMBEDDED_ID,
        "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"',
        ...extra,
      },
    };
  }
  /** The signed part of an answer, with the result of the check that a phone makes. */
  async function signedPart(response: Response, name: "manifest" | "directive") {
    const part = multipartParts(response.headers.get("content-type") ?? "", await response.text()).find(
      (candidate) => candidate.name === name,
    );
    if (!part) return null;
    const signature = part.headers.get("expo-signature") ?? "";
    return { json: JSON.parse(part.body), valid: verifySignature(part.body, signature, keys.certificatePem) };
  }
  async function servedId(init: RequestInit): Promise<string | null> {
    const response = await request("/manifest", init);
    return response.status === 200 ? ((await signedPart(response, "manifest"))?.json.id ?? null) : null;
  }
  const publish = async (
    directory: string,
    rollout: number,
    message: string,
    minute: number,
    signer = keys,
    of: UpdateScope = scope,
  ) =>
    publishUpdate(store, {
      scope: of,
      update: await readExport(directory, of.platform),
      assetBaseUrl: `${SERVER}/assets`,
      expoClient: { name: "OpenBot", version: "9.9.9" },
      commit: "0".repeat(40),
      message,
      rollout,
      keys: signer,
      now: new Date(Date.UTC(2026, 10, 10, 12, minute)),
    });

  // 1. No update, and requests that are not valid.
  const empty = await request("/manifest", phone());
  check("a binary with no update gets an empty 204 answer of protocol 1", empty.status === 204, {
    status: empty.status,
    protocol: empty.headers.get("expo-protocol-version"),
  });
  check("the empty answer names protocol 1", empty.headers.get("expo-protocol-version") === "1");
  check("a request with no platform is refused", (await request("/manifest", { headers: {} })).status === 400);
  check(
    "a request of protocol 0 is refused",
    (await request("/manifest", phone({ "expo-protocol-version": "0" }))).status === 400,
  );
  check("a write request is refused", (await request("/manifest", { ...phone(), method: "POST" })).status === 405);
  check("an asset name that is not a hash is not found", (await request("/assets/..%2Fpointers")).status === 404);

  // 2. A full publish.
  const first = await publish(await writeExport("export-1", "bundle one"), 100, "first", 1);
  const answer = await request("/manifest", phone());
  const manifest = await signedPart(answer, "manifest");
  check("a published update comes back as a manifest", answer.status === 200 && manifest?.json.id === first.update.id);
  check("the certificate accepts the manifest signature", manifest?.valid === true);
  check("the manifest has the runtime version of the binary", manifest?.json.runtimeVersion === scope.runtimeVersion);
  const files = manifest ? [manifest.json.launchAsset, ...manifest.json.assets] : [];
  let filesMatch = files.length === 3;
  for (const file of files) {
    const download = await request(new URL(file.url).pathname);
    const bytes = new Uint8Array(await download.arrayBuffer());
    filesMatch &&=
      download.status === 200 &&
      createHash("sha256").update(bytes).digest("base64url") === file.hash &&
      download.headers.get("content-type") === file.contentType &&
      (download.headers.get("cache-control") ?? "").includes("immutable");
  }
  check("each file of the manifest downloads with its hash, type and a permanent cache time", filesMatch, files);
  check(
    "asset keys are the MD5 names that the app looks for",
    files.slice(1).every((file) => /^[0-9a-f]{32}$/u.test(file.key)),
  );
  check(
    "a phone that runs the update gets the empty answer",
    (await request("/manifest", phone({ "expo-current-update-id": first.update.id }))).status === 204,
  );
  const noSignature = new Headers(phone().headers);
  noSignature.delete("expo-expect-signature");
  const unsigned = await request("/manifest", { headers: noSignature });
  check(
    "a phone that expects no signature gets the manifest with no signature header",
    unsigned.status === 200 && !(await unsigned.text()).includes("expo-signature"),
  );

  // 3. The cache: a second request of the same location reads nothing from the bucket.
  await request("/manifest", phone());
  bucketReads = 0;
  const again = await request("/manifest", phone(), false);
  check("a second request is answered from the cache", again.status === 200 && bucketReads === 0, { bucketReads });

  // 4. Other binaries are not affected.
  check(
    "another runtime version gets no update",
    (await request("/manifest", phone({}, { ...scope, runtimeVersion: "runtime-b" }))).status === 204,
  );
  check(
    "another channel gets no update",
    (await request("/manifest", phone({}, { ...scope, channel: "preview" }))).status === 204,
  );
  check(
    "the other platform gets no update",
    (await request("/manifest", phone({}, { ...scope, platform: "android" }))).status === 204,
  );

  // 5. A part rollout.
  const second = await publish(await writeExport("export-2", "bundle two"), 20, "second", 2);
  const installs = Array.from({ length: 300 }, (_, index) => `install-${index}`);
  const served: (string | null)[] = [];
  for (const install of installs) served.push(await servedId(phone({ "eas-client-id": install })));
  const onSecond = served.filter((id) => id === second.update.id).length;
  check("a 20% rollout reaches a part of the installs", onSecond > 30 && onSecond < 95, { onSecond, of: 300 });
  check(
    "the other installs keep the earlier update",
    served.every((id) => id === second.update.id || id === first.update.id),
  );
  const repeat: (string | null)[] = [];
  for (const install of installs.slice(0, 40)) repeat.push(await servedId(phone({ "eas-client-id": install })));
  check("an install keeps its place in the rollout", repeat.join() === served.slice(0, 40).join());
  check("an install with no ID waits for the full rollout", (await servedId(phone())) === first.update.id);

  await changeRollout(store, scope, 100, new Date(Date.UTC(2026, 10, 10, 12, 3)));
  const afterFull: (string | null)[] = [];
  for (const install of installs.slice(0, 40)) afterFull.push(await servedId(phone({ "eas-client-id": install })));
  check(
    "a full rollout reaches all installs",
    afterFull.every((id) => id === second.update.id),
  );
  check(
    "an update that failed on a phone is not sent to it again",
    (await request("/manifest", phone({ "expo-recent-failed-update-ids": `"${second.update.id}"` }))).status === 204,
  );

  // 6. A key that the certificate does not accept.
  await run(
    join(BIN, "expo-updates"),
    [
      "codesigning:generate",
      "--key-output-directory",
      join(temp, "other-keys"),
      "--certificate-output-directory",
      join(temp, "other-certs"),
      "--certificate-validity-duration-years",
      "1",
      "--certificate-common-name",
      "Another key",
    ],
    { cwd: MOBILE },
  );
  const wrongKey = await readFile(join(temp, "other-keys", "private-key.pem"), "utf8");
  const refused = await publish(await writeExport("export-3", "bundle three"), 100, "wrong key", 4, {
    ...keys,
    privateKeyPem: wrongKey,
  }).then(
    () => null,
    (error: Error) => error.message,
  );
  check(
    "a publish with a key that the certificate does not accept changes nothing",
    refused !== null && (await servedId(phone())) === second.update.id,
    refused,
  );

  // 7. A rollback to the earlier update, then to the bundle in the binary.
  const back = await rollBack(store, { scope, toEmbedded: false, keys, now: new Date(Date.UTC(2026, 10, 10, 12, 5)) });
  const backAnswer = await signedPart(
    await request("/manifest", phone({ "expo-current-update-id": second.update.id })),
    "manifest",
  );
  check(
    "a rollback publishes the earlier bundle again as a newer update",
    back.republished?.republishOf === first.update.id &&
      backAnswer?.json.id === back.republished.id &&
      backAnswer.json.id !== first.update.id &&
      backAnswer.json.launchAsset.hash === manifest?.json.launchAsset.hash &&
      Date.parse(backAnswer.json.createdAt) > Date.parse(second.update.createdAt),
  );
  check("the certificate accepts the signature of the rollback", backAnswer?.valid === true);

  await rollBack(store, { scope, toEmbedded: false, keys, now: new Date(Date.UTC(2026, 10, 10, 12, 6)) });
  const directiveAnswer = await request("/manifest", phone({ "expo-current-update-id": back.republished?.id ?? "" }));
  const directive = await signedPart(directiveAnswer, "directive");
  check(
    "a second rollback sends a signed directive to use the bundle in the binary",
    directive?.json.type === "rollBackToEmbedded" &&
      directive.valid &&
      Date.parse(directive.json.parameters.commitTime) > Date.parse(backAnswer?.json.createdAt ?? ""),
    directive?.json,
  );
  check(
    "a phone that runs the bundle of its binary gets the empty answer",
    (await request("/manifest", phone())).status === 204,
  );
  const third = await publish(await writeExport("export-4", "bundle four"), 100, "after the rollback", 7);
  check("a publish after a rollback reaches the phones", (await servedId(phone())) === third.update.id);
  check("the pointer keeps the history of the changes", ((await readPointer(store, scope))?.history.length ?? 0) === 6);

  // 8. A change in the bucket without the key.
  const stored = JSON.parse((await store.read(updateKey(third.update.id))) ?? "{}");
  stored.manifest = stored.manifest
    .replace(third.update.id, third.update.id)
    .replace("after the rollback", "changed text");
  await store.write(updateKey(third.update.id), JSON.stringify(stored), "application/json");
  const changed = await signedPart(await request("/manifest", phone()), "manifest");
  check("a manifest that is changed in the bucket has no valid signature", changed !== null && changed.valid === false);
  await store.write(pointerKey(scope.channel, scope.platform, "runtime-c"), "not json", "application/json");
  check(
    "a pointer that is not valid gives no update",
    (await request("/manifest", phone({}, { ...scope, runtimeVersion: "runtime-c" }))).status === 204,
  );

  // 9. A rollout change and a rollback find the binary from the store builds, not from the checkout.
  const androidBuild: UpdateScope = { channel: "production", platform: "android", runtimeVersion: "store-android-1" };
  const build = (of: UpdateScope, number: string): StoreBuild => ({
    platform: of.platform,
    version: "9.9.9",
    build: number,
    runtimeVersion: of.runtimeVersion,
    commit: "0".repeat(40),
  });
  const iosBuild: UpdateScope = { ...androidBuild, platform: "ios", runtimeVersion: "store-ios-1" };
  const builds = [build(iosBuild, "7"), build(androidBuild, "7")];
  const androidUpdate = await publish(
    await writeExport("export-5", "bundle five"),
    100,
    "android only",
    8,
    keys,
    androidBuild,
  );
  const live = await liveUpdateScopes(store, {
    channel: "production",
    platforms: ["ios", "android"],
    runtime: null,
    builds,
  });
  check(
    "a change for all platforms finds the platform that has an update and names the one that has none",
    live.scopes.length === 1 &&
      live.scopes[0]?.runtimeVersion === androidBuild.runtimeVersion &&
      live.skipped.join() === "ios",
    live,
  );
  for (const found of live.scopes) {
    await rollBack(store, { scope: found, toEmbedded: false, keys, now: new Date(Date.UTC(2026, 10, 10, 12, 9)) });
  }
  const androidBack = await signedPart(
    await request("/manifest", phone({ "expo-current-update-id": androidUpdate.update.id }, androidBuild)),
    "directive",
  );
  check(
    "the rollback for all platforms takes back the update of the one platform that has it",
    androidBack?.json.type === "rollBackToEmbedded" && androidBack.valid,
  );
  const outcome = (operation: Promise<object>) =>
    operation.then(
      () => null,
      (error: Error) => error.message,
    );
  const noUpdate = await outcome(
    liveUpdateScopes(store, { channel: "production", platforms: ["ios", "android"], runtime: null, builds }),
  );
  check("a change with no update on any platform stops", noUpdate !== null, noUpdate);

  const olderAndroid: UpdateScope = { ...androidBuild, runtimeVersion: "store-android-0" };
  await publish(await writeExport("export-6", "bundle six"), 100, "newer store version", 10, keys, androidBuild);
  await publish(await writeExport("export-7", "bundle seven"), 100, "older store version", 11, keys, olderAndroid);
  const twoBuilds = [...builds, build(olderAndroid, "6")];
  const ambiguous = await outcome(
    liveUpdateScopes(store, { channel: "production", platforms: ["android"], runtime: null, builds: twoBuilds }),
  );
  check(
    "two store versions with an update need the runtime version",
    ambiguous?.includes("--runtime") === true && ambiguous.includes(olderAndroid.runtimeVersion),
    ambiguous,
  );
  const named = await liveUpdateScopes(store, {
    channel: "production",
    platforms: ["android"],
    runtime: olderAndroid.runtimeVersion,
    builds: [],
  });
  check(
    "a runtime version names one binary, with no tag",
    named.scopes.length === 1 && named.scopes[0]?.runtimeVersion === olderAndroid.runtimeVersion,
  );
  const twoPlatforms = await outcome(
    liveUpdateScopes(store, { channel: "production", platforms: ["ios", "android"], runtime: "store-ios-1", builds }),
  );
  check(
    "a runtime version with two platforms is refused",
    twoPlatforms?.includes("one platform") === true,
    twoPlatforms,
  );

  // 10. The EAS build copies the project with its own ignore logic: it leaves a file out when one
  // `.gitignore` file ignores it by itself, also when a deeper file includes it again, as git allows.
  // A build with no certificate stops at `expo prebuild`.
  const appJson = JSON.parse(await readFile(join(MOBILE, "app.json"), "utf8"));
  const certificatePath = posix.join("apps/mobile", String(appJson.expo.updates.codeSigningCertificate));
  const ignoreFiles = (await run("git", ["ls-files", "--", ".gitignore", "**/.gitignore"], { cwd: ROOT })).stdout
    .split("\n")
    .filter(Boolean);
  const leftOutBy: string[] = [];
  for (const [index, file] of ignoreFiles.entries()) {
    const folder = file.slice(0, -".gitignore".length);
    if (!certificatePath.startsWith(folder)) continue;
    const alone = join(temp, `ignore-${index}`);
    await mkdir(alone);
    await run("git", ["init", "--quiet"], { cwd: alone });
    await copyFile(join(ROOT, file), join(alone, ".gitignore"));
    const ignored = await run("git", ["check-ignore", "--quiet", "--no-index", certificatePath.slice(folder.length)], {
      cwd: alone,
    }).then(
      () => true,
      () => false,
    );
    if (ignored) leftOutBy.push(file);
  }
  check("the EAS project copy keeps the update signing certificate", leftOutBy.length === 0, leftOutBy);

  // 11. The publish guard, with the real runtime version of this checkout and a local tag remote.
  const android = await fingerprint("android", MOBILE);
  const remote = join(temp, "remote");
  await mkdir(remote);
  const gitIn = (...args: string[]) => run("git", args, { cwd: remote });
  await gitIn("init", "--quiet");
  await gitIn(
    "-c",
    "user.name=e2e",
    "-c",
    "user.email=e2e@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "build",
  );
  await gitIn("tag", storeBuildTag({ platform: "android", version: "9.9.9", build: "7", runtimeVersion: android }));
  await gitIn(
    "tag",
    storeBuildTag({ platform: "ios", version: "9.9.9", build: "7", runtimeVersion: "another-runtime" }),
  );
  const guard = async (platform: string) => {
    const result = await run(
      "bun",
      [join(ROOT, "scripts", "mobile-ota.ts"), "publish", "--platform", platform, "--message", "guard", "--dry-run"],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          MOBILE_OTA_REMOTE: remote,
          EXPO_PUBLIC_OPENPANEL_CLIENT_ID: "e2e",
          EXPO_PUBLIC_OPENPANEL_CLIENT_SECRET: "e2e",
          GITHUB_STEP_SUMMARY: "",
        },
      },
    ).then(
      (done) => ({ code: 0, text: done.stdout }),
      (error: { code?: number; stdout?: string }) => ({ code: error.code ?? -1, text: error.stdout ?? "" }),
    );
    return result;
  };
  const passes = await guard("android");
  check("the guard passes a commit whose runtime version a store build has", passes.code === 0, passes);
  const refuses = await guard("ios");
  check(
    "the guard refuses a commit whose runtime version no store build has",
    refuses.code === 1 && refuses.text.includes("needs a store build"),
    refuses,
  );
  const both = await guard("all");
  check("one refused platform stops the publish of all platforms", both.code === 1, both);
} finally {
  await proxy.dispose();
  await rm(temp, { recursive: true, force: true });
}

const failed = steps.filter((step) => !step.passed);
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: failed.length === 0, steps }, null, 2)}\n`);
for (const step of steps) process.stdout.write(`${step.passed ? "ok  " : "FAIL"} ${step.name}\n`);
if (failed.length > 0) {
  process.stderr.write(`${failed.length} of ${steps.length} checks failed. See ${join(OUT, "report.json")}.\n`);
  process.exitCode = 1;
}
