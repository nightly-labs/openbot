import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { argument } from "./channel-e2e-support";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

const NAME = "workflow-duplicate-references";
const ROOT = resolve(import.meta.dirname, "..");
const HOST_NAME = "OpenBot Local Dev Host";
const PICTURE_SIDE = 64;
const REFERENCES = 2;
const SOURCE = "image-original";
const WAIT_MS = 60_000;
const logger = createOpenBotLogger(NAME);

const clients = (argument("clients") ?? "local").split(",").filter(Boolean);
const allowMutations = process.argv.includes("--allow-mutations");
const outDir = join(ROOT, ".openbot-build", NAME);

interface SavedEdge {
  from: string;
  to: string;
  type: string;
}

interface ClientResult {
  client: string;
  workflowId: string;
  copyId: string;
  references: string[];
  copiedReferences: string[];
  originalReferences: string[];
  copySelected: boolean;
  originalSelected: boolean;
}

function instance(service: DevInstanceRecord["service"]): DevInstanceRecord {
  const found = readDevInstanceRecords().filter(
    (record) => record.service === service && resolve(record.projectRoot) === ROOT,
  );
  assert.equal(found.length, 1, `Expected one ${service} instance of this worktree. Start dev:test-client.`);
  const [record] = found;
  assert.ok(record);
  return record;
}

async function connect(record: DevInstanceRecord) {
  assertMutationAllowed({
    command: NAME,
    allowMutations,
    instanceNamed: true,
    target: `${record.service} ${record.instanceId}`,
  });
  return connectToDevApp(record.remoteDebuggingPort, logger, {
    expectedRendererPort: record.rendererPort,
    ownerPid: record.pid,
  });
}

async function makePicture(host: Page, name: string): Promise<string> {
  return host.evaluate(
    async ({ name, side }) => {
      const canvas = new OffscreenCanvas(side, side);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D context.");
      context.fillStyle = `hsl(${Math.round(Math.random() * 360)} 60% 50%)`;
      context.fillRect(0, 0, side, side);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const [draft] = await window.openbot.agent.importAttachmentData([{ name, mimeType: "image/png", bytes }]);
      if (!draft) throw new Error("The host kept no draft.");
      return window.openbot.workflows.keepPicture(draft.id);
    },
    { name, side: PICTURE_SIDE },
  );
}

async function seedWorkflow(host: Page, title: string) {
  const assets = [];
  for (let index = 0; index < REFERENCES; index += 1) {
    const name = `${title}-${index}.png`.replaceAll(" ", "-");
    assets.push({
      id: `asset-${index}`,
      kind: "asset" as const,
      at: { x: 0, y: index * 320 },
      fields: { file: name, fileId: await makePicture(host, name) },
    });
  }
  const image = {
    id: SOURCE,
    kind: "image" as const,
    at: { x: 520, y: 0 },
    fields: { prompt: "A wool-felt robot waves at the camera" },
  };
  const edges = assets.map((asset) => ({
    id: `${asset.id}>${SOURCE}:image`,
    from: asset.id,
    to: SOURCE,
    type: "image" as const,
  }));
  const created = await host.evaluate((input) => window.openbot.workflows.create(input), {
    title,
    graph: { nodes: [...assets, image], edges, strokes: [] },
  });
  return { workflowId: created.summary.id, references: assets.map((asset) => asset.id) };
}

async function openWorkflows(page: Page): Promise<void> {
  const serverMenu = page.getByRole("button", { name: /^Open server menu for / });
  if ((await serverMenu.getAttribute("aria-label")) !== `Open server menu for ${HOST_NAME}`) {
    await serverMenu.click();
    await page.getByRole("menuitem", { name: HOST_NAME, exact: true }).click();
    await page.getByRole("button", { name: `Open server menu for ${HOST_NAME}`, exact: true }).waitFor();
  }
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("main", { name: /^Workflow canvas: / }).waitFor({ timeout: WAIT_MS });
}

async function openWorkflow(page: Page, title: string): Promise<void> {
  const canvas = page.getByRole("main", { name: /^Workflow canvas: / });
  const current = (await canvas.getAttribute("aria-label"))?.replace(/^Workflow canvas: /, "") ?? "";
  await canvas.getByRole("button", { name: current, exact: true }).first().click();
  await page.getByRole("menuitem", { name: new RegExp(`^${title} `) }).click();
  await page.getByRole("main", { name: `Workflow canvas: ${title}`, exact: true }).waitFor({ timeout: WAIT_MS });
}

async function duplicateSource(page: Page): Promise<void> {
  const node = page.locator(`[data-node-id="${SOURCE}"]`).first();
  await node.waitFor({ timeout: WAIT_MS });
  await node.click({ button: "right", position: { x: 8, y: 8 } });
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
}

async function savedEdges(host: Page, workflowId: string) {
  const saved = await host.evaluate(
    async ({ workflowId, source, wait }) => {
      const deadline = Date.now() + wait;
      while (Date.now() < deadline) {
        const detail = await window.openbot.workflows.get(workflowId);
        const copy = detail.graph.nodes.find((node) => node.kind === "image" && node.id !== source);
        if (copy) {
          const edges: SavedEdge[] = detail.graph.edges.map((edge) => ({
            from: edge.from,
            to: edge.to,
            type: edge.type,
          }));
          return { copyId: copy.id, edges };
        }
        await new Promise((done) => setTimeout(done, 250));
      }
      return null;
    },
    { workflowId, source: SOURCE, wait: WAIT_MS },
  );
  assert.ok(saved, "The duplicate was not saved.");
  return saved;
}

async function selectionAfterDuplicate(page: Page, copyId: string) {
  await page.locator(`article[data-node-id="${copyId}"][data-selected]`).waitFor({ timeout: WAIT_MS });
  return page.evaluate(
    (ids) =>
      ids.map(
        (id) => document.querySelector<HTMLElement>(`article[data-node-id="${id}"]`)?.dataset.selected !== undefined,
      ),
    [copyId, SOURCE],
  );
}

function referencesOf(edges: readonly SavedEdge[], to: string): string[] {
  return edges
    .filter((edge) => edge.to === to && edge.type === "image")
    .map((edge) => edge.from)
    .sort();
}

async function checkClient(client: string): Promise<ClientResult> {
  const hostSession = await connect(instance("app"));
  const clientSession = client === "remote" ? await connect(instance("test-client")) : hostSession;
  try {
    await openWorkflows(clientSession.page);
    const title = `Duplicate references ${client} ${Date.now()}`;
    const { workflowId, references } = await seedWorkflow(hostSession.page, title);
    await openWorkflow(clientSession.page, title);
    await duplicateSource(clientSession.page);
    const { copyId, edges } = await savedEdges(hostSession.page, workflowId);
    const [copySelected = false, originalSelected = true] = await selectionAfterDuplicate(clientSession.page, copyId);
    const result = {
      client,
      workflowId,
      copyId,
      references,
      copiedReferences: referencesOf(edges, copyId),
      originalReferences: referencesOf(edges, SOURCE),
      copySelected,
      originalSelected,
    };
    assert.deepEqual(result.copiedReferences, references, `${client}: the copy has other reference connections.`);
    assert.deepEqual(result.originalReferences, references, `${client}: the original lost a reference connection.`);
    assert.ok(copySelected && !originalSelected, `${client}: the menu did not select only the copy.`);
    logger.info(`${client}: the copy ${copyId} has ${result.copiedReferences.length} reference connections`);
    return result;
  } finally {
    if (clientSession !== hostSession) await clientSession.close();
    await hostSession.close();
  }
}

const results: ClientResult[] = [];
for (const client of clients) results.push(await checkClient(client));
mkdirSync(outDir, { recursive: true });
const report = join(outDir, "report.json");
writeFileSync(report, `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`);
logger.info(`wrote ${report}`);
