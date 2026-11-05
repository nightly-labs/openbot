// Starts the real `ProviderRuntimeManager` with a partial provider CLI download and an injected
// fetch, as tests and Node-only callers do. Checks that the manager resumes with `Range` and
// `If-Range`, that it keeps the injected fetch instead of the global one, and that it accepts a
// matching 206 before the final size check rejects the deliberately short body.
// `bun scripts/provider-runtime-download-resume-e2e.ts`.
// Writes .openbot-build/provider-runtime-download-resume-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ManagedProviderId } from "@openbot/contracts/ipc";
import lockValue from "../native-runtime.lock.json";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { providerRuntimeDescriptor } from "../src/main/provider-runtime-descriptors";
import { ProviderRuntimeManager, runtimeTarget } from "../src/main/provider-runtime-manager";
import { parseAgentRuntimeLock } from "./agent-runtime-lock";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-runtime-download-resume-e2e");
/** The provider whose pinned download the manager resumes. */
const RUNTIME: ManagedProviderId = "opencode";
const PARTIAL_BYTES = 1024;
const ETAG = '"resume-test"';

interface RecordedRequest {
  url: string;
  range: string | null;
  ifRange: string | null;
}

interface Report {
  passed: boolean;
  requests?: RecordedRequest[];
  failure?: string | null;
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-download-resume-e2e-"));
const downloads = join(root, "downloads");
const report: Report = { passed: false };
const requests: RecordedRequest[] = [];
let manager: ProviderRuntimeManager | null = null;

try {
  const target = runtimeTarget(process.platform, process.arch);
  assert.ok(target, "this platform has managed runtimes");
  const lock = parseAgentRuntimeLock(lockValue);
  const spec = providerRuntimeDescriptor(RUNTIME).spec(target, lock);
  const partialPath = join(downloads, `${spec.runtime}-${spec.target}-${spec.version}.partial`);
  await mkdir(downloads, { recursive: true });
  await writeFile(partialPath, Buffer.alloc(PARTIAL_BYTES));
  await writeFile(
    `${partialPath}.json`,
    `${JSON.stringify({ url: spec.url, etag: ETAG, expectedBytes: spec.downloadBytes })}\n`,
  );

  manager = new ProviderRuntimeManager({
    root,
    downloadRoot: downloads,
    availableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
    fetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: input instanceof URL ? input.href : String(input),
        range: headers.get("range"),
        ifRange: headers.get("if-range"),
      });
      return new Response(new Uint8Array(PARTIAL_BYTES), {
        status: 206,
        headers: {
          etag: ETAG,
          "content-range": `bytes ${PARTIAL_BYTES}-${PARTIAL_BYTES * 2 - 1}/${spec.downloadBytes}`,
        },
      });
    },
  });
  await runCauseEffect(manager.initialize());

  let failure: string | null = null;
  await runCauseEffect(manager.downloadAndWait(RUNTIME)).catch((error: unknown) => {
    failure = error instanceof Error ? error.message : String(error);
  });

  report.requests = requests;
  report.failure = failure;
  assert.equal(requests.length, 1, "the injected fetch is used once; a rejected 206 would fetch again from zero");
  assert.equal(requests[0]?.range, `bytes=${PARTIAL_BYTES}-`, "the download resumes at the partial size");
  assert.equal(requests[0]?.ifRange, ETAG, "the download sends the saved ETag");
  assert.ok(failure, "the short body fails the final size check");
  report.passed = true;
} finally {
  if (manager) await runCauseEffect(manager.stop()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
