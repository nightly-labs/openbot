import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { type Browser, chromium } from "playwright-core";

const logger = createOpenBotLogger("site-locales-e2e");

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/site-locales");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const browserExecutable = option("browser-executable");
const givenOrigin = option("origin");

const LOCALES = ["ar", "de", "es", "fr", "he", "it", "ja", "ko", "nl", "pl", "pt", "ru", "tr", "zh"] as const;
const RIGHT_TO_LEFT = new Set<string>(["ar", "he"]);
const PAGES = ["/", "/teams", "/pricing", "/contact"] as const;
const SITEMAP_PAGES = ["/", "/teams", "/pricing"] as const;
const ALTERNATE_COUNT = LOCALES.length + 2;
const SCREENSHOTS = [
  { path: "/ar", file: "ar-home.png" },
  { path: "/he/teams", file: "he-teams.png" },
  { path: "/he/pricing", file: "he-pricing.png" },
  { path: "/ar/contact", file: "ar-contact.png" },
  { path: "/zh/teams", file: "zh-teams.png" },
  { path: "/ja", file: "ja-home.png" },
] as const;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      server.close(() => done(address.port));
    });
  });

function waitForSite(child: ChildProcess, address: string): Promise<void> {
  return new Promise((done, fail) => {
    let output = "";
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(address)) done();
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", () => fail(new Error("The site's development server stopped before it listened.")));
  });
}

function localizedPath(locale: string, page: string): string {
  return page === "/" ? `/${locale}` : `/${locale}${page}`;
}

interface PageHead {
  lang: string;
  dir: string;
  title: string;
  description: string;
  alternates: number;
}

async function pageHead(origin: string, path: string): Promise<PageHead> {
  const response = await fetch(new URL(path, origin), { headers: { "accept-language": "en" } });
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  const html = await response.text();
  const htmlTag = html.match(/<html\b[^>]*>/u)?.[0] ?? "";
  return {
    lang: htmlTag.match(/\blang="([^"]*)"/u)?.[1] ?? "",
    dir: htmlTag.match(/\bdir="([^"]*)"/u)?.[1] ?? "",
    title: html.match(/<title>([^<]*)<\/title>/u)?.[1] ?? "",
    description: html.match(/<meta name="description" content="([^"]*)"/u)?.[1] ?? "",
    alternates: html.match(/<link [^>]*rel="alternate"[^>]*hreflang=/gu)?.length ?? 0,
  };
}

async function checkPages(origin: string) {
  const results: Record<string, PageHead> = {};
  for (const page of PAGES) {
    const english = await pageHead(origin, page);
    assert.equal(english.dir, "ltr", `${page} is not left to right`);
    results[page] = english;
    for (const locale of LOCALES) {
      const path = localizedPath(locale, page);
      const head = await pageHead(origin, path);
      assert.ok(head.lang.startsWith(locale), `${path} has lang="${head.lang}"`);
      assert.equal(head.dir, RIGHT_TO_LEFT.has(locale) ? "rtl" : "ltr", `${path} has dir="${head.dir}"`);
      assert.equal(head.alternates, ALTERNATE_COUNT, `${path} has ${head.alternates} hreflang links`);
      assert.notEqual(head.description, english.description, `${path} shows the English description`);
      results[path] = head;
    }
  }
  return results;
}

const CLOSING_HEADINGS = [
  { path: "/he/teams", contains: "שעמיתי" },
  { path: "/zh/teams", contains: "同事完成" },
  { path: "/teams", contains: "your AI coworkers to" },
] as const;

async function checkClosingHeadings(origin: string): Promise<Record<string, string>> {
  const headings: Record<string, string> = {};
  for (const check of CLOSING_HEADINGS) {
    const html = await (await fetch(new URL(check.path, origin))).text();
    const inner = html.match(/<h2[^>]*id="teams-closing-title"[^>]*>([\s\S]*?)<\/h2>/u)?.[1] ?? "";
    const text = inner
      .replace(/<!--[\s\S]*?-->/gu, "")
      .replace(/<[^>]+>/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    assert.ok(text.includes(check.contains), `${check.path} closing heading is "${text}"`);
    headings[check.path] = text;
  }
  return headings;
}

async function checkSitemap(origin: string): Promise<string[]> {
  const response = await fetch(new URL("/sitemap.xml", origin));
  assert.equal(response.status, 200);
  const xml = await response.text();
  const urls = [...xml.matchAll(/<loc>https:\/\/openbot\.run([^<]*)<\/loc>/gu)].map((match) => match[1] ?? "");
  const expected = SITEMAP_PAGES.flatMap((page) => LOCALES.map((locale) => localizedPath(locale, page)));
  const missing = expected.filter((path) => !urls.includes(path));
  assert.deepEqual(missing, [], "The sitemap does not list these localized pages");
  return expected;
}

async function checkLanguageMenu(browser: Browser, origin: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 640 }, locale: "es-ES" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/es/pricing`);
  const list = page.locator(".site-language-list");
  await page.locator(".site-language-trigger").click();
  await list.waitFor({ state: "visible" });
  const links = await list.getByRole("link").count();
  const target = list.locator('a[hreflang^="ja"]');
  await target.scrollIntoViewIfNeeded();
  const box = await list.boundingBox();
  assert.ok(box, "The language list has no box");
  assert.ok(box.y + box.height <= 640, "The language list goes past the bottom of the window");
  await page.screenshot({ path: resolve(OUT, "language-menu.png") });
  await target.click();
  await page.waitForURL(`${origin}/ja/pricing`);
  await page.locator('html[lang^="ja"]').waitFor({ state: "attached" });
  const languageCookie = async () => (await context.cookies()).find((item) => item.name === "openbot_lang")?.value;
  const cookie = await languageCookie();
  assert.equal(cookie, "ja");
  await page.locator(".site-language-trigger").click();
  await list.locator('a[hreflang^="en"]').click();
  await page.waitForURL(`${origin}/pricing`);
  await page.locator('html[lang^="en"][dir="ltr"]').waitFor({ state: "attached" });
  const cookieAfterEnglish = await languageCookie();
  assert.equal(cookieAfterEnglish, "en");
  assert.deepEqual(errors, []);
  await context.close();
  return {
    links,
    listBottom: Math.round(box.y + box.height),
    switchedTo: "/ja/pricing",
    cookie,
    switchedBack: "/pricing",
    cookieAfterEnglish,
  };
}

async function takeScreenshots(browser: Browser, origin: string) {
  const overflow: Record<string, number> = {};
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const shot of SCREENSHOTS) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}${shot.path}`);
    await page.locator("h1").first().waitFor();
    overflow[shot.path] = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    await page.screenshot({ path: resolve(OUT, shot.file) });
    assert.deepEqual(errors, [], `${shot.path} threw page errors`);
    assert.equal(overflow[shot.path], 0, `${shot.path} scrolls sideways`);
    await page.close();
  }
  await context.close();
  return overflow;
}

const port = givenOrigin ? 0 : await freePort();
const origin = givenOrigin ?? `http://127.0.0.1:${port}`;
const site = givenOrigin
  ? null
  : spawn(
      process.execPath,
      [
        resolve(ROOT, "scripts/run-development.ts"),
        "api",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
let siteOutput = "";
site?.stdout?.on("data", (chunk: Buffer) => {
  siteOutput += chunk.toString();
});
site?.stderr?.on("data", (chunk: Buffer) => {
  siteOutput += chunk.toString();
});

try {
  if (site) await waitForSite(site, origin);
  const pages = await checkPages(origin);
  const sitemap = await checkSitemap(origin);
  const closingHeadings = await checkClosingHeadings(origin);
  const browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  try {
    const languageMenu = await checkLanguageMenu(browser, origin);
    const sidewaysOverflow = await takeScreenshots(browser, origin);
    const report = {
      ok: true,
      pages,
      sitemap,
      closingHeadings,
      languageMenu,
      sidewaysOverflow,
      screenshots: ["language-menu.png", ...SCREENSHOTS.map((shot) => shot.file)],
    };
    writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    logger.info(`Passed. Report: ${resolve(OUT, "report.json")}`);
  } finally {
    await browser.close();
  }
} catch (error) {
  if (site) writeFileSync(resolve(OUT, "site-output.log"), siteOutput);
  throw error;
} finally {
  if (site) {
    const exited = new Promise<void>((done) => (site.exitCode === null ? site.once("exit", () => done()) : done()));
    site.kill("SIGTERM");
    await exited;
  }
}
