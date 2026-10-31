// Runs the catalog's Pagey MCP adapter as a real child process. The default run uses a loopback
// HTTP service and needs no account. --live publishes one expiring site to Pagey with the token
// from PAGEY_API_TOKEN. Reports contain no credentials. Run: bun scripts/pagey-plugin-e2e.ts.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { unzipSync, zipSync } from "fflate";
import { loadPluginCatalog } from "./build-plugin-catalog";

const out = resolve(".openbot-build/pagey-plugin");
await mkdir(out, { recursive: true });
const work = await mkdtemp(join(out, "run-"));
const checks: Array<{ name: string; passed: boolean }> = [];
const live = process.argv.includes("--live");
const credential = live ? process.env.PAGEY_API_TOKEN : `pagey-e2e-${randomUUID()}`;
assert.ok(credential, "PAGEY_API_TOKEN is required for --live.");
const siteId = randomUUID();
const record: {
  id: string;
  subdomain: string;
  title: string;
  status: string;
  contentRevision: number;
  maintenanceMode: boolean;
  expiresAt: string | null;
} = {
  id: siteId,
  subdomain: `openbot-e2e-${randomUUID().slice(0, 8)}`,
  title: "OpenBot E2E",
  status: "active",
  contentRevision: 1,
  maintenanceMode: false,
  expiresAt: null,
};
let files: Record<string, Uint8Array> = {};
let requests = 0;
const uploads: number[] = [];
const server = createServer((req, res) => {
  void serve(req)
    .then((result) => {
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.body));
    })
    .catch(() => {
      res.writeHead(500);
      res.end("{}");
    });
});
async function serve(req: IncomingMessage) {
  requests++;
  assert.ok(req.headers.authorization === `Bearer ${credential}`, "The API token must use the Authorization header.");
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const data = Buffer.concat(chunks);
  if (req.method === "POST" || req.method === "PUT") {
    const form = await new Request("http://127.0.0.1", {
      method: "POST",
      headers: { "content-type": req.headers["content-type"] ?? "" },
      body: data,
    }).formData();
    const file = form.get("file");
    assert.ok(file instanceof File, "The upload must be a multipart file.");
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    assert.ok(files["index.html"], "The upload must have a root index.html.");
    uploads.push(Object.keys(files).length);
    if (req.method === "POST") {
      record.title = String(form.get("title") ?? record.title);
      record.expiresAt = String(form.get("expiresAt") ?? "") || null;
    } else record.contentRevision++;
    return {
      status: req.method === "POST" ? 201 : 200,
      body: { site: { ...record, passwordHash: credential, ownerUserId: credential } },
    };
  }
  if (url.searchParams.get("search") === "rate-limit") return { status: 429, body: { error: credential } };
  if (url.searchParams.get("search") === "redirect") return { status: 302, body: {} };
  if (url.searchParams.get("search") === "redact")
    return { status: 200, body: { page: 1, pageSize: 20, total: 1, items: [{ ...record, title: credential }] } };
  if (req.method === "PATCH") {
    const body = JSON.parse(data.toString());
    if (url.pathname.endsWith("/maintenance")) record.maintenanceMode = body.enabled;
    else {
      if ("title" in body) record.title = body.title;
      if ("expiresAt" in body) record.expiresAt = body.expiresAt;
    }
  }
  if (url.pathname.endsWith("/analytics"))
    return { status: 200, body: { analytics: { pageViews: 2, uniqueVisitors: 1 } } };
  return {
    status: 200,
    body: url.pathname === "/api/sites" ? { page: 1, pageSize: 20, total: 1, items: [record] } : { site: record },
  };
}
let base: string | undefined;
if (!live) {
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
}
const { plugins } = await loadPluginCatalog(resolve("marketplace/plugin-catalog"));
const listing = plugins.find((plugin) => plugin.slug === "pagey");
assert.ok(listing);
const config = listing.apps[0]?.server;
assert.ok(config?.transport === "stdio");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: config.args,
  env: { PATH: process.env.PATH ?? "", PAGEY_API_TOKEN: credential, ...(base ? { PAGEY_API_URL: base } : {}) },
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  stderr += String(chunk);
});
const client = new Client({ name: "pagey-e2e", version: "1.0.0" });
async function tool(name: string, args: Record<string, string | number | boolean | null> = {}, error = false) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(Boolean(result.isError) === error, `${name} returned an unexpected error state.`);
  const text = JSON.stringify(result);
  assert.ok(!text.includes(credential ?? ""), "A tool result exposed the API token.");
  const content = result.content;
  assert.ok(Array.isArray(content));
  const first = content[0];
  assert.ok(first && first.type === "text" && typeof first.text === "string");
  return error ? first.text : JSON.parse(first.text);
}
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks.push({ name, passed: true });
}
let published: { id: string; url: string } | undefined;
try {
  await client.connect(transport);
  await check("MCP initialize and tool discovery", async () => {
    const result = await client.listTools();
    assert.equal(result.tools.length, 8);
    assert.ok(result.tools.find((entry) => entry.name === "update_site_content")?.annotations?.destructiveHint);
  });
  const html = join(work, "hello.html");
  await writeFile(
    html,
    "<!doctype html><html><head><title>OpenBot Pagey check</title></head><body>OpenBot Pagey publish check</body></html>",
  );
  let preview = await tool("preview_upload", { path: html });
  await check("HTML preview sends no network request", async () => {
    assert.equal(preview.files[0].path, "index.html");
    assert.equal(requests, 0);
  });
  await check("Reject changed files before upload", async () => {
    await writeFile(html, "<!doctype html><html><body>OpenBot Pagey publish check v2</body></html>");
    await tool("publish_site", { path: html, expectedDigest: preview.digest }, true);
    assert.equal(requests, 0);
    preview = await tool("preview_upload", { path: html });
  });
  await check("Publish one expiring HTML site", async () => {
    const result = await tool("publish_site", {
      path: html,
      expectedDigest: preview.digest,
      title: `OpenBot plugin check ${randomUUID().slice(0, 8)}`,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.ok(result.site.id && result.site.url.startsWith("https://"));
    published = result.site;
  });
  assert.ok(published);
  const current = published;
  await check("List and get the published site", async () => {
    const result = await tool("list_sites", { search: current.url.split("//")[1]?.split(".")[0] ?? "", pageSize: 100 });
    assert.ok(result.items.some((item: { id: string }) => item.id === current.id));
    assert.equal((await tool("get_site", { siteId: current.id })).site.url, current.url);
  });
  const folder = join(work, "dist");
  await mkdir(join(folder, "assets"), { recursive: true });
  await writeFile(
    join(folder, "index.html"),
    '<!doctype html><html><head><link rel="stylesheet" href="assets/site.css"></head><body>OpenBot Pagey folder check v3</body></html>',
  );
  await writeFile(join(folder, "assets/site.css"), "body { color: navy; }");
  await check("Replace content with a folder and keep the URL", async () => {
    const next = await tool("preview_upload", { path: folder });
    await tool("update_site_content", {
      siteId: current.id,
      path: folder,
      expectedDigest: next.digest,
      confirmReplace: true,
    });
    assert.equal((await tool("get_site", { siteId: current.id })).site.url, current.url);
    if (!live) {
      assert.ok(files["assets/site.css"]);
      assert.equal(uploads[1], 2);
    }
  });
  await check("ZIP preview and upload", async () => {
    const zipped = join(work, "site.zip");
    await writeFile(
      zipped,
      zipSync({
        "index.html": new TextEncoder().encode("<!doctype html><html><body>OpenBot Pagey ZIP check v4</body></html>"),
        "assets/site.css": new TextEncoder().encode("body { color: navy; }"),
      }),
    );
    const next = await tool("preview_upload", { path: zipped });
    assert.equal(next.files.length, 2);
    await tool("update_site_content", {
      siteId: current.id,
      path: zipped,
      expectedDigest: next.digest,
      confirmReplace: true,
    });
  });
  await check("Change title and read analytics", async () => {
    const result = await tool("update_site", { siteId: current.id, title: "OpenBot Pagey plugin check" });
    assert.equal(result.site.title, "OpenBot Pagey plugin check");
    assert.ok((await tool("get_analytics", { siteId: current.id })).analytics);
  });
  await check("Enable and disable maintenance", async () => {
    assert.equal((await tool("set_maintenance", { siteId: current.id, enabled: true })).site.maintenanceMode, true);
    assert.equal((await tool("set_maintenance", { siteId: current.id, enabled: false })).site.maintenanceMode, false);
  });
  await check("Reject secret files, source maps, links, missing index, and ZIP traversal", async () => {
    const before = requests;
    for (const name of [".env", "debug.map", "storage.db"]) {
      const unsafe = join(work, `unsafe-${randomUUID()}`);
      await mkdir(unsafe);
      await writeFile(join(unsafe, "index.html"), "<p>test</p>");
      await writeFile(join(unsafe, name), "test");
      await tool("preview_upload", { path: unsafe }, true);
    }
    const linked = join(work, "linked.html");
    await symlink(html, linked);
    await tool("preview_upload", { path: linked }, true);
    const unsafeZip = join(work, "unsafe.zip");
    await writeFile(unsafeZip, zipSync({ "index.html": new Uint8Array([65]), "../secret.txt": new Uint8Array([66]) }));
    await tool("preview_upload", { path: unsafeZip }, true);
    const missing = join(work, "missing");
    await mkdir(missing);
    await writeFile(join(missing, "readme.txt"), "test");
    await tool("preview_upload", { path: missing }, true);
    const secretFile = join(work, "secret.html");
    await writeFile(secretFile, live ? "ghp_" + "exampleCredential12345678" : credential);
    await tool("preview_upload", { path: secretFile }, true);
    assert.equal(requests, before);
  });
  await check("Validate tool fields before network calls", async () => {
    const before = requests;
    await tool("get_site", { siteId: "../../auth/api-tokens" }, true);
    await tool("set_maintenance", { siteId: current.id, enabled: "false" }, true);
    await tool("publish_site", { path: html, expectedDigest: preview.digest, extra: true }, true);
    await tool("publish_site", { path: html, expectedDigest: preview.digest, expiresAt: "2000-01-01" }, true);
    await tool(
      "update_site_content",
      { path: html, siteId: current.id, expectedDigest: preview.digest, confirmReplace: false },
      true,
    );
    assert.equal(requests, before);
  });
  if (!live) {
    await check("Redact secrets in API data and discard API error bodies", async () => {
      const result = await tool("list_sites", { search: "redact" });
      assert.equal(result.items[0].title, "[REDACTED]");
      await tool("list_sites", { search: "rate-limit" }, true);
      await tool("list_sites", { search: "redirect" }, true);
    });
    await check("Remove an expiry", async () => {
      assert.equal((await tool("update_site", { siteId: current.id, expiresAt: null })).site.expiresAt, null);
    });
  } else {
    await check("Public site serves the new content and nested asset", async () => {
      const page = await fetch(current.url, { signal: AbortSignal.timeout(30000) });
      assert.equal(page.status, 200);
      assert.ok((await page.text()).includes("OpenBot Pagey ZIP check v4"));
      const css = await fetch(`${current.url}/assets/site.css`, { signal: AbortSignal.timeout(30000) });
      assert.equal(css.status, 200);
      assert.ok((await css.text()).includes("navy"));
    });
  }
  assert.ok(!stderr.includes(credential), "The adapter wrote a credential to stderr.");
} catch (error) {
  checks.push({
    name: error instanceof Error ? error.message.replaceAll(credential, "[REDACTED]") : "E2E failure",
    passed: false,
  });
  process.exitCode = 1;
} finally {
  await client.close();
  if (!live) await new Promise<void>((done) => server.close(() => done()));
  await writeFile(
    join(out, live ? "live-report.json" : "report.json"),
    JSON.stringify(
      { live, passed: checks.every((item) => item.passed), checks, site: published, temporaryFiles: work },
      null,
      2,
    ),
  );
  // Machine-readable: one result for manual runs and CI.
  process.stdout.write(
    `${JSON.stringify({ live, passed: checks.every((item) => item.passed), checks: checks.length, report: join(out, live ? "live-report.json" : "report.json"), site: published?.url })}\n`,
  );
}
