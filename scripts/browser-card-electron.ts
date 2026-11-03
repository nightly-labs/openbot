import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { app, BrowserWindow, type WebContents, type WebFrameMain, webContents } from "electron";
import { z } from "zod";
import { BrowserHost } from "../src/backend/browser-host";
import type { BrowserCardVault } from "../src/backend/browser-tool-actions";
import { BROWSER_DYNAMIC_TOOLS } from "../src/backend/browser-tools";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams, DynamicToolResult } from "../src/backend/protocol";
import type { VaultCardSecret } from "../src/backend/vault-items";
import { parseBrowserToolText } from "./browser-snapshot-text";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

// A test card number with a valid checksum. It is not a real account.
const CARD: VaultCardSecret = {
  number: "4242424242424242",
  securityCode: "737",
  expMonth: 3,
  expYear: 2030,
  nameOnCard: "Ada Lovelace",
};
const CARD_ID = "card-fixture";
const CHECKOUT = "https://checkout.openbot.test";
const SCRIPTED = "https://scripted.openbot.test";
// A refused evaluate still marks the checkout site as scripted, so later fills use another site.
const SHOP = "https://shop.openbot.test";
const PAYMENTS = "https://payments.cardfixture.test";

const snapshotSchema = z.object({
  tabId: z.string(),
  revision: z.number(),
  title: z.string(),
  elements: z.array(z.object({ ref: z.string(), name: z.string(), tag: z.string().optional() })),
});
const fillSchema = z.object({
  filled: z.array(z.string()),
  unconfirmed: z.array(z.string()).optional(),
  snapshot: snapshotSchema,
});

const cases: string[] = [];
const formats: Record<string, string> = {};
let currentPhase = "entry";
let sequence = 0;

/** A form a page can show: main-frame fields with native month and year selects, or a frame's one expiry field. */
function checkoutForm(kind: "selects" | "expiry", method = "post"): string {
  const months = Array.from(
    { length: 12 },
    (_, index) =>
      `<option value="${String(index + 1).padStart(2, "0")}">${String(index + 1).padStart(2, "0")} - ${new Date(Date.UTC(2000, index, 1)).toLocaleString("en", { month: "long", timeZone: "UTC" })}</option>`,
  ).join("");
  const years = Array.from({ length: 10 }, (_, index) => `<option>${2026 + index}</option>`).join("");
  return `<form method="${method}" action="/pay">
    ${kind === "selects" ? '<label>Name on card<input id="name" autocomplete="cc-name"></label>' : ""}
    <label>Card number<input id="number" inputmode="numeric" autocomplete="cc-number"></label>
    <label>Security code<input id="code" inputmode="numeric" autocomplete="cc-csc"></label>
    ${
      kind === "selects"
        ? `<label>Expiry month<select id="month"><option value="">Month</option>${months}</select></label>
    <label>Expiry year<select id="year"><option value="">Year</option>${years}</select></label>`
        : '<label>Expiry date<input id="expiry" placeholder="MM / YY"></label>'
    }
    <button type="button">Pay</button>
  </form>
  <script>
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement) event.target.dataset.trusted = String(event.isTrusted);
    // Some pages echo a field in the title. The agent must not read the number there.
    if (event.target.id === 'number') document.title = 'Card ' + event.target.value;
  });
  </script>`;
}

function page(body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><title>Checkout</title></head><body>${body}</body></html>`,
    {
      headers: { "Content-Type": "text/html" },
    },
  );
}

const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><title>Checkout</title>${checkoutForm("selects")}`);
});

let browser: BrowserHost | undefined;
let window: BrowserWindow | undefined;

void main().catch((error) => {
  process.stderr.write(`${redactText(String(error))}\n`);
  app.exit(1);
});

async function main(): Promise<void> {
  app.setPath("userData", join(fixtureRoot, "profile"));
  app.setPath("sessionData", join(fixtureRoot, "session"));
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  phase("entry-start");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object", "Fixture server address missing.");
    const httpOrigin = `http://127.0.0.1:${address.port}`;
    await app.whenReady();
    window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"));
    const host = browser;

    // HTTPS is served inside the browser session, so no certificate or network service is used.
    phase("https-fixtures");
    const seed = await runCauseEffect(host.open(`${httpOrigin}/seed`, "card-thread", "card-agent"));
    const seedContents = webContents.getAllWebContents().find((contents) => contents.getURL() === seed.url);
    assert(seedContents, "Missing fixture session.");
    const protocol = seedContents.session.protocol;
    protocol.handle("https", (request) => {
      const url = new URL(request.url);
      if (url.origin === PAYMENTS) return page(checkoutForm("expiry"));
      if (url.origin !== CHECKOUT && url.origin !== SCRIPTED && url.origin !== SHOP)
        return new Response("Not found", { status: 404 });
      if (url.pathname === "/framed")
        return page(
          `<label>Name on card<input id="name" autocomplete="cc-name"></label><iframe title="Card frame" src="${PAYMENTS}/fields" width="500" height="300"></iframe>`,
        );
      if (url.pathname === "/get") return page(checkoutForm("selects", "get"));
      if (url.pathname === "/next") return page("<h1>Order placed</h1>");
      return page(checkoutForm("selects"));
    });
    await runCauseEffect(host.close(seed.id));

    const params = (tool: string, args: DynamicToolCallParams["arguments"]): DynamicToolCallParams => ({
      namespace: "openbot_browser",
      tool,
      arguments: args,
      ownerAgentId: "card-agent",
      threadId: "card-thread",
      turnId: "card-turn",
      callId: `card-${++sequence}`,
    });
    // The owner's approvals, as the Vault keeps them, and the answer the owner gives to the next card.
    const approvedSites = new Map<string, Set<string>>();
    const approvals: Array<{ page: string; frames: readonly string[] }> = [];
    let ownerAnswer = true;
    const cardVault: BrowserCardVault = {
      secret: (cardId) => (cardId === CARD_ID ? CARD : null),
      approved: (_cardId, page, frames) => frames.every((frame) => approvedSites.get(page)?.has(frame)),
      approve: (_cardId, page, frames) =>
        Effect.sync(() => {
          approvals.push({ page, frames });
          if (!ownerAnswer) return false;
          approvedSites.set(page, new Set([...(approvedSites.get(page) ?? []), ...frames]));
          return true;
        }),
    };
    const call = (tool: string, args: DynamicToolCallParams["arguments"]) =>
      runCauseEffect(host.handleDynamicTool(params(tool, args), { cardVault }));
    const text = (result: DynamicToolResult) =>
      result.contentItems.map((item) => (item.type === "inputText" ? item.text : "")).join("\n");
    const failure = (result: DynamicToolResult) => {
      assert(!result.success, "The call succeeded where a refusal was expected.");
      return text(result);
    };
    /** No card value in a text that leaves the host. */
    const assertHidden = (value: string, where: string) => {
      assert(!/4242[\s.-]*4242[\s.-]*4242[\s.-]*4242/u.test(value), `The card number is in ${where}.`);
      assert(!/(?<![0-9])737(?![0-9])/u.test(value), `The security code is in ${where}.`);
    };
    const contentsOf = (url: string) => {
      const contents = webContents.getAllWebContents().find((item) => !item.isDestroyed() && item.getURL() === url);
      assert(contents, "Missing fixture contents.");
      return contents;
    };
    /** Waits until the document, and each frame in it, has loaded. */
    const loaded = async (contents: WebContents, frames = 1) => {
      for (;;) {
        const ready = await Promise.all(
          contents.mainFrame.framesInSubtree.map((frame) =>
            frame.executeJavaScript("document.readyState === 'complete'").catch(() => false),
          ),
        );
        if (ready.length >= frames && ready.every(Boolean)) return;
        await new Promise<void>((resolve) => contents.once("did-frame-finish-load", () => resolve()));
      }
    };
    const open = async (url: string, frames = 1) => {
      const opened = await call("open", { url: `${url}${url.includes("?") ? "&" : "?"}n=${++sequence}` });
      assert(opened.success, "Fixture tab did not open.");
      const tab = z.object({ tab: z.object({ id: z.string(), url: z.string() }) }).parse(JSON.parse(text(opened))).tab;
      const contents = contentsOf(tab.url);
      await loaded(contents, frames);
      return { tabId: tab.id, contents };
    };
    const snapshot = async (tabId: string) => {
      const result = await call("snapshot", { tabId, image: "never" });
      assert(result.success, "Fixture snapshot failed.");
      assertHidden(text(result), "a snapshot");
      return snapshotSchema.parse(parseBrowserToolText(text(result)));
    };
    const ref = (current: z.infer<typeof snapshotSchema>, name: string) => {
      const element = current.elements.find((item) => item.name === name);
      assert(element, `The ${name} field is not in the snapshot.`);
      return { kind: "ref", ref: element.ref, revision: current.revision };
    };
    const fieldValues = z.record(z.string(), z.object({ value: z.string(), trusted: z.string().nullable() }));
    const values = async (frame: WebContents | WebFrameMain) =>
      fieldValues.parse(
        await frame.executeJavaScript(
          "Object.fromEntries([...document.querySelectorAll('input, select')].map((field) => [field.id, { value: field.value, trusted: field.dataset.trusted ?? null }]))",
        ),
      );

    assert(
      BROWSER_DYNAMIC_TOOLS.some((namespace) =>
        ["fill_card", "list_vault_items"].every((name) => namespace.tools.some((tool) => tool.name === name)),
      ),
      "The tool catalog lacks fill_card or list_vault_items.",
    );
    recordCases("catalog");

    phase("main-frame-fill");
    const main = await open(`${CHECKOUT}/checkout`);
    const before = await snapshot(main.tabId);
    const mainTargets = {
      number: ref(before, "Card number"),
      securityCode: ref(before, "Security code"),
      expMonth: ref(before, "Expiry month"),
      expYear: ref(before, "Expiry year"),
      nameOnCard: ref(before, "Name on card"),
    };
    const recording = await call("recording_start", { tabId: main.tabId });
    assert(recording.success, `Recording did not start: ${text(recording)}`);
    ownerAnswer = false;
    const declined = await call("fill_card", { tabId: main.tabId, cardId: CARD_ID, targets: mainTargets });
    assert(failure(declined).includes("did not approve"), "A declined fill was not refused.");
    assert.equal((await values(main.contents)).number?.value, "", "A declined fill typed the number.");
    // A hidden window records no frames, so the stop can fail; a discarded recording fails another way.
    const kept = await call("recording_stop", { tabId: main.tabId });
    assert(!text(kept).includes("not being recorded"), "A declined fill discarded the recording.");
    assert.deepEqual(approvals, [{ page: CHECKOUT, frames: [CHECKOUT] }], "The approval did not name the page.");
    ownerAnswer = true;
    const mainFill = await call("fill_card", { tabId: main.tabId, cardId: CARD_ID, targets: mainTargets });
    assert(mainFill.success, `Main-frame fill failed: ${redactText(text(mainFill))}`);
    assert.equal(approvals.length, 2, "The approved fill did not ask the owner once.");
    assertHidden(text(mainFill), "the fill result");
    const mainResult = fillSchema.parse(parseBrowserToolText(text(mainFill)));
    assert.deepEqual(
      [...mainResult.filled].sort(),
      ["expMonth", "expYear", "nameOnCard", "number", "securityCode"],
      "The fill result does not name each field.",
    );
    assert.equal(mainResult.unconfirmed, undefined, "A main-frame field did not hold its value.");
    const mainValues = await values(main.contents);
    assert.equal(mainValues.number?.value, CARD.number, "The number did not arrive.");
    assert.equal(mainValues.code?.value, CARD.securityCode, "The security code did not arrive.");
    assert.equal(mainValues.name?.value, CARD.nameOnCard, "The name did not arrive.");
    assert.equal(mainValues.month?.value, "03", "The month option is wrong.");
    assert.equal(mainValues.year?.value, "2030", "The year option is wrong.");
    assert.equal(mainValues.number?.trusted, "true", "The number input was not native.");
    formats.selects = `${mainValues.month?.value}/${mainValues.year?.value}`;
    recordCases(
      "approval-declined-types-nothing",
      "approval-declined-keeps-recording",
      "approval-names-page",
      "main-frame-fill",
      "result-names-fields-only",
      "native-input",
      "select-month-year",
    );

    phase("scrub");
    const after = await snapshot(main.tabId);
    assert(after.title.includes("•••• 4242"), "The snapshot title was not scrubbed.");
    const tabs = await call("list_tabs", {});
    assertHidden(text(tabs), "list_tabs");
    const revealing = await call("click", {
      tabId: main.tabId,
      target: { kind: "text", text: CARD.number },
    });
    assert(failure(revealing).includes("cannot name a filled card value"), "A revealing target was not refused.");
    const revealingWait = await call("wait_for", { tabId: main.tabId, text: CARD.securityCode, timeoutMs: 200 });
    assert(failure(revealingWait).includes("filled card value"), "A revealing wait was not refused.");
    recordCases("snapshot-scrub", "list-tabs-scrub", "revealing-target-refused");

    phase("capture-gates");
    assert(failure(await call("screenshot", { tabId: main.tabId })).includes("filled card"), "Screenshot ran.");
    assert(
      failure(await call("snapshot", { tabId: main.tabId, image: "always" })).includes("filled card"),
      "A snapshot image was taken.",
    );
    const auto = await call("snapshot", { tabId: main.tabId, image: "auto" });
    assert(
      auto.success && auto.contentItems.every((item) => item.type !== "inputImage"),
      "An automatic snapshot image was taken.",
    );
    assert(
      failure(await call("evaluate", { tabId: main.tabId, expression: "1" })).includes("unavailable"),
      "Evaluation ran.",
    );
    assert(failure(await call("recording_start", { tabId: main.tabId })).includes("unavailable"), "Recording started.");
    const preview = await runCauseEffect(host.capturePreview(main.tabId)).then(
      () => "captured",
      (error: unknown) => String(error),
    );
    assert(preview.includes("filled card"), "A preview was captured.");
    recordCases(
      "screenshot-refused",
      "snapshot-image-refused",
      "evaluate-refused",
      "recording-refused",
      "preview-refused",
    );

    phase("navigation-clears");
    const navigated = await call("navigate", { tabId: main.tabId, url: `${CHECKOUT}/next` });
    assert(navigated.success, "Navigation failed.");
    const shot = await call("screenshot", { tabId: main.tabId });
    assert(shot.success, "Screenshot stayed blocked after navigation.");
    recordCases("navigation-clears-gates");

    phase("payment-frame-fill");
    const framed = await open(`${SHOP}/framed`, 2);
    const paymentFrame = framed.contents.mainFrame.framesInSubtree.find((frame) => frame.origin === PAYMENTS);
    assert(paymentFrame, "The payment frame did not load.");
    const outOfProcess = paymentFrame.processId !== framed.contents.mainFrame.processId;
    const framedSnapshot = await snapshot(framed.tabId);
    const frameFill = await call("fill_card", {
      tabId: framed.tabId,
      cardId: CARD_ID,
      targets: {
        number: ref(framedSnapshot, "Card number"),
        securityCode: ref(framedSnapshot, "Security code"),
        expiry: ref(framedSnapshot, "Expiry date"),
        nameOnCard: ref(framedSnapshot, "Name on card"),
      },
    });
    assert(frameFill.success, `Payment-frame fill failed: ${redactText(text(frameFill))}`);
    assert.deepEqual(
      approvals.at(-1),
      { page: SHOP, frames: [PAYMENTS, SHOP] },
      "The approval did not name the page and each frame origin.",
    );
    assertHidden(text(frameFill), "the frame fill result");
    const frameValues = await values(paymentFrame);
    assert.equal(frameValues.number?.value, CARD.number, "The number did not reach the payment frame.");
    assert.equal(frameValues.code?.value, CARD.securityCode, "The security code did not reach the payment frame.");
    assert.equal(frameValues.expiry?.value, "03 / 30", "The expiry does not follow the placeholder.");
    assert.equal(frameValues.number?.trusted, "true", "The frame number input was not native.");
    assert.equal((await values(framed.contents)).name?.value, CARD.nameOnCard, "The name did not arrive.");
    formats.placeholder = String(frameValues.expiry?.value);
    const asked = approvals.length;
    const refill = await call("fill_card", {
      tabId: framed.tabId,
      cardId: CARD_ID,
      targets: { number: ref(await snapshot(framed.tabId), "Card number") },
    });
    assert(refill.success, `The approved site was refused: ${redactText(text(refill))}`);
    assert.equal(approvals.length, asked, "An approved site asked the owner again.");
    recordCases("payment-frame-fill", "expiry-placeholder-format", "approval-frames-named", "approved-site-no-ask");
    await runCauseEffect(host.close(framed.tabId));

    phase("refusals");
    const unknown = await call("fill_card", {
      tabId: main.tabId,
      cardId: "card-missing",
      targets: { number: { kind: "css", selector: "#number" } },
    });
    assert(failure(unknown).includes("No saved card"), "An unknown card was not refused.");
    const plain = await open(`${httpOrigin}/checkout`);
    const plainSnapshot = await snapshot(plain.tabId);
    const insecure = await call("fill_card", {
      tabId: plain.tabId,
      cardId: CARD_ID,
      targets: { number: ref(plainSnapshot, "Card number") },
    });
    assert(failure(insecure).includes("HTTPS"), "An HTTP page was not refused.");
    assert.equal((await values(plain.contents)).number?.value, "", "The HTTP page received the number.");
    const get = await open(`${SHOP}/get`);
    const getSnapshot = await snapshot(get.tabId);
    const getFill = await call("fill_card", {
      tabId: get.tabId,
      cardId: CARD_ID,
      targets: { number: ref(getSnapshot, "Card number") },
    });
    assert(failure(getFill).includes("page address"), "A GET form was not refused.");
    const scripted = await open(`${SCRIPTED}/checkout`);
    assert((await call("evaluate", { tabId: scripted.tabId, expression: "1" })).success, "Evaluation failed.");
    const scriptedSnapshot = await snapshot(scripted.tabId);
    const scriptedFill = await call("fill_card", {
      tabId: scripted.tabId,
      cardId: CARD_ID,
      targets: { number: ref(scriptedSnapshot, "Card number") },
    });
    assert(failure(scriptedFill).includes("evaluate"), "A scripted site was not refused.");
    assert.equal((await values(scripted.contents)).number?.value, "", "The scripted page received the number.");
    recordCases("unknown-card-refused", "http-refused", "get-form-refused", "scripted-origin-refused");

    protocol.unhandle("https");
    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      cases,
      paymentFrameOutOfProcess: outOfProcess,
      expiryFormats: formats,
      scope: "Owned hidden native process, temporary profile, synthetic HTTPS pages and a test card number.",
    };
    assertHidden(JSON.stringify(report), "the report");
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify({ status: "failed", runId, sourceSha: argument("source-sha"), phase: currentPhase, cases, reason: redactText(String(error)) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  } finally {
    phase("native-cleanup");
    if (browser) await runCauseEffect(browser.destroy());
    if (window && !window.isDestroyed()) window.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.exit(Number(process.exitCode ?? 0));
  }
}

function phase(name: string): void {
  currentPhase = name;
  // Machine-readable: phase receipts contain no page or card data.
  process.stdout.write(`${JSON.stringify({ runId, phase: name, status: "running" })}\n`);
}

function recordCases(...names: string[]): void {
  for (const name of names) {
    cases.push(name);
    process.stdout.write(`${JSON.stringify({ runId, case: name, status: "passed" })}\n`);
  }
}
