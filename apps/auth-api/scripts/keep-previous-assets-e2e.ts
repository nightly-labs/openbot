// Three deploys in a row keep the code files of earlier builds (issue #4087). Each deploy runs the real
// `keep-previous-assets.ts` process against a local site that serves the previous deploy's output:
// - the first deploy finds no history and records only its own files;
// - the second keeps the first build's files, and drops a file that is too old, one that the site
//   no longer has, one that the site answers with a page, and a name that is not a flat file name;
// - the third keeps the files of both earlier builds, and a kept file keeps the time it stopped being live.
// `bun run test:keep-previous-assets`. Writes .openbot-build/keep-previous-assets-e2e.json.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";
import { Schema } from "effect";

const OUT = resolve(import.meta.dirname, "../../../.openbot-build/keep-previous-assets-e2e.json");
const SCRIPT = resolve(import.meta.dirname, "keep-previous-assets.ts");
const HOUR_MS = 60 * 60 * 1000;

const History = Schema.Struct({
  version: Schema.Literal(1),
  files: Schema.Record(Schema.String, Schema.NullOr(Schema.Number)),
});
type History = typeof History.Type;

const DeployResult = Schema.Struct({
  built: Schema.Number,
  kept: Schema.Number,
  missing: Schema.Number,
  failed: Schema.Number,
  expired: Schema.Number,
  historyFound: Schema.Boolean,
});
type DeployResult = typeof DeployResult.Type;

interface Report {
  passed: boolean;
  deploys: { name: string; result: DeployResult; history: History }[];
  failure?: string;
}

/** The live site: the files of one deploy's output. A path with no file gets the Worker's 404 page. */
async function serveSite(): Promise<{ server: Server; origin: string; setRoot: (root: string) => void }> {
  let root = "";
  /** Names that the site answers with a page and status 200, as a fallback route would. */
  const pages = new Set(["page.js"]);
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://site").pathname));
    const file = join(root, path);
    if (path.startsWith("/assets/") && pages.has(path.slice("/assets/".length))) {
      response.writeHead(200, { "content-type": "text/html" }).end("<html></html>");
      return;
    }
    if (!root || !file.startsWith(root) || !existsSync(file)) {
      response.writeHead(404, { "content-type": "text/html" }).end("<html>Not found</html>");
      return;
    }
    void readFile(file).then((body) => {
      const type = file.endsWith(".json") ? "application/json" : "text/javascript";
      response.writeHead(200, { "content-type": type }).end(body);
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return { server, origin: `http://127.0.0.1:${address.port}`, setRoot: (next) => (root = next) };
}

async function build(root: string, files: Record<string, string>): Promise<string> {
  await mkdir(join(root, "assets"), { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(root, "assets", name), body);
  return root;
}

async function deploy(origin: string, clientDir: string): Promise<{ result: DeployResult; history: History }> {
  const output = await new Promise<string>((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [SCRIPT, `--origin=${origin}`, `--client=${clientDir}`], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.once("error", rejectRun);
    child.once("exit", (code) => (code === 0 ? resolveRun(stdout) : rejectRun(new Error(`exit ${code}`))));
  });
  const line = output.trim().split("\n").at(-1) ?? "";
  const history = Schema.decodeUnknownSync(Schema.fromJsonString(History))(
    await readFile(join(clientDir, "asset-history.json"), "utf8"),
  );
  return { result: Schema.decodeUnknownSync(Schema.fromJsonString(DeployResult))(line), history };
}

async function main(): Promise<void> {
  const report: Report = { passed: false, deploys: [] };
  const work = await mkdtemp(join(tmpdir(), "keep-previous-assets-"));
  const site = await serveSite();
  try {
    // 1. No history on the site.
    const first = await build(join(work, "first"), { "index-a.js": "a", "pkg@1~a.js": "pkg", "shared.js": "shared" });
    const one = await deploy(site.origin, first);
    report.deploys.push({ name: "first", ...one });
    assert.equal(one.result.historyFound, false);
    assert.equal(one.result.kept, 0);
    assert.deepEqual(one.history.files, { "index-a.js": null, "pkg@1~a.js": null, "shared.js": null });

    // 2. The first deploy is live. Its history also names files that must not be kept.
    const now = Date.now();
    await writeFile(join(first, "assets", "stale.js"), "stale");
    await writeFile(
      join(first, "asset-history.json"),
      JSON.stringify({
        version: 1,
        files: {
          ...one.history.files,
          "stale.js": now - 25 * HOUR_MS,
          "gone.js": now - HOUR_MS,
          "page.js": now - HOUR_MS,
          "../asset-history.json": now - HOUR_MS,
        },
      } satisfies History),
    );
    site.setRoot(first);
    const second = await build(join(work, "second"), { "index-b.js": "b", "shared.js": "shared" });
    const before = Date.now();
    const two = await deploy(site.origin, second);
    report.deploys.push({ name: "second", ...two });
    assert.equal(two.result.historyFound, true);
    assert.deepEqual(
      { kept: two.result.kept, missing: two.result.missing, failed: two.result.failed, expired: two.result.expired },
      { kept: 2, missing: 1, failed: 1, expired: 1 },
    );
    assert.equal(await readFile(join(second, "assets", "index-a.js"), "utf8"), "a");
    assert.equal(await readFile(join(second, "assets", "pkg@1~a.js"), "utf8"), "pkg");
    assert.equal(existsSync(join(second, "assets", "stale.js")), false);
    assert.equal(existsSync(join(second, "assets", "page.js")), false);
    assert.deepEqual(Object.keys(two.history.files).sort(), ["index-a.js", "index-b.js", "pkg@1~a.js", "shared.js"]);
    const retiredA = two.history.files["index-a.js"];
    assert.ok(typeof retiredA === "number" && retiredA >= before, "The first build stops being live now.");
    assert.equal(two.history.files["shared.js"], null);

    // 3. The second deploy is live.
    site.setRoot(second);
    const third = await build(join(work, "third"), { "index-c.js": "c", "shared.js": "shared" });
    const three = await deploy(site.origin, third);
    report.deploys.push({ name: "third", ...three });
    assert.equal(three.result.kept, 3);
    assert.equal(await readFile(join(third, "assets", "index-a.js"), "utf8"), "a");
    assert.equal(await readFile(join(third, "assets", "index-b.js"), "utf8"), "b");
    assert.equal(three.history.files["index-a.js"], retiredA, "A kept file keeps its time.");
    assert.ok((three.history.files["index-b.js"] ?? 0) >= (retiredA ?? 0));
    assert.equal(three.history.files["index-c.js"], null);
    report.passed = true;
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    site.server.close();
    await rm(work, { recursive: true, force: true });
    await mkdir(resolve(OUT, ".."), { recursive: true });
    await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);
  }
}

await main();
