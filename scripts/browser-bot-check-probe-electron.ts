import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { app, BrowserWindow, type WebContents } from "electron";
import { z } from "zod";
import { BrowserHost } from "../src/backend/browser-host";
import type { DynamicToolCallParams } from "../src/backend/protocol";
import { parseBrowserToolText } from "./browser-snapshot-text";

// Opens each live site once in the real BrowserHost, as an agent does, and records what the bot
// check of the site did: the `challenge` field of the snapshot, the HTTP status of the document,
// and a page image. It follows the agent's guidance (wait while `checking`, one click on
// `click-once`) and solves nothing.

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const pagePreload = argument("page-preload");
const SITE_TIMEOUT_MS = 75_000;
const EMPTY_PAGE_WAIT_MS = 8_000;
// The GPU switches of a server host (`configureLinuxGpu` in src/main/linux-gpu-mode.ts).
if (process.argv.includes("--server-gpu")) {
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}

const siteSchema = z.object({ id: z.union([z.string(), z.number()]), website: z.string(), category: z.string() });
const pageSchema = z.object({
  tabId: z.string(),
  url: z.string(),
  title: z.string().optional(),
  elements: z.array(z.unknown()).optional(),
  challenge: z
    .object({
      vendor: z.string(),
      status: z.string(),
      waitedMs: z.number(),
      target: z.object({ kind: z.literal("point"), x: z.number(), y: z.number() }).optional(),
    })
    .optional(),
});
const openedTabSchema = z.object({ tab: z.object({ id: z.string() }), snapshotError: z.string() });
type Page = z.infer<typeof pageSchema>;

interface SiteResult {
  id: string | number;
  website: string;
  category: string;
  ms: number;
  url?: string;
  title?: string;
  httpStatus?: number;
  elements?: number;
  textLength?: number;
  text?: string;
  /** Each challenge status that the reads returned, in order. */
  statuses: string[];
  vendor?: string;
  clicked: boolean;
  /** What the page reads as the browser version and brands. */
  identity?: string;
  error?: string;
}

const results: SiteResult[] = [];
let sequence = 0;
/** The status of the last main-frame document of each tab's contents. */
const httpStatus = new Map<number, number>();
let lastContents: WebContents | undefined;

/** A function call keeps the type: the navigation listener assigns the variable. */
function latestContents(): WebContents | undefined {
  return lastContents;
}

void main().catch((error) => {
  process.stderr.write(`${redactText(String(error))}\n`);
  app.exit(1);
});

async function main(): Promise<void> {
  app.setPath("userData", join(fixtureRoot, "profile"));
  app.setPath("sessionData", join(fixtureRoot, "session"));
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  const sites = z.array(siteSchema).parse(JSON.parse(await readFile(argument("sites"), "utf8")));
  await mkdir(join(dirname(reportPath), "images"), { recursive: true });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("did-navigate", (_navigation, _url, code) => {
      httpStatus.set(contents.id, code);
      lastContents = contents;
    });
  });
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    opacity: 0,
    width: 1024,
    height: 768,
    focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const host = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"), {
    pagePreload,
  });
  const call = async (tool: string, args: DynamicToolCallParams["arguments"]) => {
    const result = await Effect.runPromise(
      host.handleDynamicTool({
        namespace: "openbot_browser",
        tool,
        arguments: args,
        ownerAgentId: "probe-agent",
        threadId: "probe-thread",
        turnId: "probe-turn",
        callId: `probe-${++sequence}`,
      } satisfies DynamicToolCallParams),
    );
    const item = result.contentItems.find((content) => content.type === "inputText");
    const text = item?.type === "inputText" ? item.text : "";
    if (!result.success) throw new Error(text || `${tool} failed.`);
    return parseBrowserToolText(text);
  };

  try {
    for (const site of sites) {
      const started = Date.now();
      const result: SiteResult = { ...site, ms: 0, statuses: [], clicked: false };
      results.push(result);
      let tabId: string | undefined;
      lastContents = undefined;
      const probe = async () => {
        // A page that navigates during the read gives `{ tab, snapshotError }`; the agent then reads again.
        const opened = await call("open", { url: `https://${site.website}` });
        const unread = openedTabSchema.safeParse(opened);
        if (unread.success) tabId = unread.data.tab.id;
        let page: Page = pageSchema.parse(unread.success ? await call("snapshot", { tabId, image: "never" }) : opened);
        tabId = page.tabId;
        const note = (next: Page) => {
          page = next;
          result.statuses.push(next.challenge?.status ?? "none");
          if (next.challenge) result.vendor = next.challenge.vendor;
        };
        note(page);
        for (let read = 0; read < 4 && page.challenge; read += 1) {
          const { status, target } = page.challenge;
          if (status === "checking") {
            note(pageSchema.parse(await call("snapshot", { tabId, image: "never" })));
          } else if (status === "click-once" && target && !result.clicked) {
            result.clicked = true;
            await call("click", { tabId, target });
            note(pageSchema.parse(await call("snapshot", { tabId, image: "never" })));
          } else break;
        }
        // A script check can show an empty document first and then load the page. Read it again when
        // the document has content, as an agent does after an empty snapshot.
        if (!page.challenge && (page.elements?.length ?? 0) === 0) {
          const contents = latestContents();
          const deadline = Date.now() + EMPTY_PAGE_WAIT_MS;
          while (contents && !contents.isDestroyed() && Date.now() < deadline) {
            const length = await contents
              .executeJavaScript("document.body ? document.body.innerText.length : 0", true)
              .catch(() => 0);
            if (typeof length === "number" && length > 200) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          note(pageSchema.parse(await call("snapshot", { tabId, image: "never" })));
        }
        result.url = page.url;
        if (page.title !== undefined) result.title = page.title;
        if (page.elements) result.elements = page.elements.length;
      };
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          probe(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Site probe timed out.")), SITE_TIMEOUT_MS);
          }),
        ]);
      } catch (error) {
        result.error = redactText(error instanceof Error ? error.message : String(error)).slice(0, 400);
      } finally {
        clearTimeout(timer);
      }
      const contents = latestContents();
      if (contents && !contents.isDestroyed()) {
        const status = httpStatus.get(contents.id);
        if (status !== undefined) result.httpStatus = status;
        try {
          const text = z
            .string()
            .parse(await contents.executeJavaScript("document.body ? document.body.innerText : ''", true));
          result.textLength = text.length;
          result.text = text.replace(/\s+/gu, " ").slice(0, 300);
          result.identity = z
            .string()
            .parse(
              await contents.executeJavaScript(
                "navigator.userAgent.replace(/.*Chrome/, 'Chrome') + ' ' + JSON.stringify(navigator.userAgentData.brands.map((item) => item.brand + ' ' + item.version))",
                true,
              ),
            );
          result.title ??= contents.getTitle();
          result.url ??= contents.getURL();
          const image = await contents.capturePage();
          if (!image.isEmpty())
            await writeFile(join(dirname(reportPath), "images", `${site.id}.jpg`), image.toJPEG(60));
        } catch {
          // The page left or crashed; the report keeps what the reads returned.
        }
      }
      if (tabId) await call("close_tab", { tabId }).catch(() => undefined);
      result.ms = Date.now() - started;
      process.stdout.write(
        `${site.id} ${site.website} [${site.category}] http=${result.httpStatus ?? "-"} ${result.statuses.join(">") || "-"}${result.error ? ` ERROR ${result.error.slice(0, 80)}` : ""}\n`,
      );
      await writeReport("running");
    }
    await writeReport("completed");
    app.exit(0);
  } finally {
    window.destroy();
  }
}

async function writeReport(status: "running" | "completed"): Promise<void> {
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        status,
        runId: argument("run-id"),
        sourceSha: argument("source-sha"),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        platform: process.platform,
        arch: process.arch,
        userAgent: app.userAgentFallback,
        results,
      },
      null,
      2,
    )}\n`,
  );
}
