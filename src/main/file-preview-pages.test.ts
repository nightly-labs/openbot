// @vitest-environment node

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHAT_VISUAL_PAGE_LIMIT } from "@openbot/contracts/chat-visual";
import { afterEach, describe, expect, it } from "vitest";
import { FilePreviewPages } from "./file-preview-pages";

const html = new TextEncoder().encode("<h1>Workspace report</h1><script>drawChart()</script>");

describe("workspace HTML preview pages", () => {
  it("serves only bytes registered by an authorized file preview, without accepting file paths", async () => {
    const pages = new FilePreviewPages();
    const address = pages.add("text/html", html, pages.generation);
    expect(address).toBeDefined();
    const page = pages.get(new URL(address ?? ""));
    expect(page).toEqual(html);
    const response = await pages.response(new Request(address ?? ""));
    expect(response.headers.get("Content-Security-Policy")).toBe("sandbox allow-scripts allow-forms");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.text()).toContain("drawChart()");

    for (const value of [
      "openbot-visual://preview/unknown",
      "openbot-visual://preview/etc/passwd",
      "openbot-visual://preview/%2e%2e%2fprivate.html",
      `openbot-visual://file/${new URL(address ?? "").pathname.slice(1)}`,
      `${address ?? ""}?path=/private.html`,
    ]) {
      expect(pages.get(new URL(value))).toBeUndefined();
    }
    expect(pages.get(new URL(`${address ?? ""}#theme=dark`))).toEqual(html);
  });

  it("does not publish non-HTML or oversized content", () => {
    const pages = new FilePreviewPages();
    expect(pages.add("text/plain", html, pages.generation)).toBeUndefined();
    expect(pages.add("image/svg+xml", html, pages.generation)).toBeUndefined();
    expect(pages.add("text/html", new Uint8Array(CHAT_VISUAL_PAGE_LIMIT + 1), pages.generation)).toBeUndefined();
  });

  it("keeps accepted pages alive until release and does not change when caller bytes change", () => {
    const pages = new FilePreviewPages(2);
    const bytes = html.slice();
    const first = pages.add("text/html", bytes, pages.generation);
    bytes.fill(0);
    const second = pages.add("text/html", html, pages.generation);
    expect(pages.get(new URL(first ?? ""))).toEqual(html);
    expect(pages.add("text/html", html, pages.generation)).toBeUndefined();
    expect(pages.get(new URL(first ?? ""))).toEqual(html);
    expect(pages.get(new URL(second ?? ""))).toEqual(html);
    pages.release(first ?? "");
    expect(pages.get(new URL(first ?? ""))).toBeUndefined();
    expect(pages.add("text/html", html, pages.generation)).toBeDefined();
  });

  it("rejects non-GET page requests and unknown addresses through the protocol response", async () => {
    const pages = new FilePreviewPages();
    const address = pages.add("text/html", html, pages.generation) ?? "";
    expect((await pages.response(new Request(address, { method: "POST" }))).status).toBe(404);
    expect((await pages.response(new Request(`${address}?path=/private.html`))).status).toBe(404);
    pages.release(address);
    expect((await pages.response(new Request(address))).status).toBe(404);
  });

  it("invalidates old addresses and restores capacity when the renderer is replaced", async () => {
    const pages = new FilePreviewPages(1);
    for (let reload = 0; reload < 10; reload += 1) {
      const address = pages.add("text/html", html, pages.generation);
      expect(address).toBeDefined();
      expect((await pages.response(new Request(address ?? ""))).status).toBe(200);
      pages.clear();
      expect((await pages.response(new Request(address ?? ""))).status).toBe(404);
    }
  });

  it("rejects a late page from the old renderer without consuming the new renderer's capacity", async () => {
    const pages = new FilePreviewPages(1);
    const generation = pages.generation;
    const old = pages.add("text/html", html, generation);
    pages.clear();
    pages.clear();
    expect(pages.add("text/html", html, generation)).toBeUndefined();
    const current = pages.add("text/html", html, pages.generation);
    expect(current).toBeDefined();
    pages.release(old ?? "");
    pages.release(old ?? "");
    expect((await pages.response(new Request(current ?? ""))).status).toBe(200);
  });

  describe("files next to a local HTML file (#11088)", () => {
    let root: string | undefined;
    afterEach(async () => {
      if (root) await rm(root, { recursive: true, force: true });
      root = undefined;
    });

    async function reviewFolder() {
      root = await realpath(await mkdtemp(join(tmpdir(), "openbot-preview-")));
      const folder = join(root, "review");
      await mkdir(join(folder, "images"), { recursive: true });
      await mkdir(join(folder, ".state"));
      await writeFile(join(folder, "images", "01 \u5ba1.png"), "png");
      await writeFile(join(folder, "style.css"), "img{width:1px}");
      await writeFile(join(folder, ".hidden.png"), "hidden");
      await writeFile(join(folder, ".state", "token.png"), "token");
      await writeFile(join(folder, "config.js"), "const key = 'secret';");
      await writeFile(join(root, "outside.png"), "outside");
      await symlink(join(root, "outside.png"), join(folder, "escape.png"));
      await symlink(join(folder, ".state", "token.png"), join(folder, "alias.png"));
      return folder;
    }

    it("serves images and styles under the folder at the page address, with a base for relative links", async () => {
      const pages = new FilePreviewPages();
      const address = pages.add("text/html", html, pages.generation, await reviewFolder()) ?? "";
      expect(await (await pages.response(new Request(address))).text()).toContain(`<base href="${address}/">`);
      const image = await pages.response(new Request(new URL("images/01%20%E5%AE%A1.png", `${address}/`).href));
      expect(image.status).toBe(200);
      expect(image.headers.get("Content-Type")).toBe("image/png");
      expect(image.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(image.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(await image.text()).toBe("png");
      const style = await pages.response(new Request(`${address}/style.css?v=2`));
      expect(style.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    });

    it("refuses paths outside the folder, hidden files, links that leave the folder and other file types", async () => {
      const pages = new FilePreviewPages();
      const address = pages.add("text/html", html, pages.generation, await reviewFolder()) ?? "";
      for (const path of [
        "../outside.png",
        "%2e%2e/outside.png",
        "images/..%2f..%2foutside.png",
        "images%5c..%5c..%5coutside.png",
        "escape.png",
        "alias.png",
        ".hidden.png",
        ".state/token.png",
        "config.js",
        "images",
        "images//01.png",
        "missing.png",
      ]) {
        const response = await pages.response(new Request(`${address}/${path}`));
        expect(response.status, path).toBe(404);
      }
      expect((await pages.response(new Request(`${address}/style.css`, { method: "POST" }))).status).toBe(404);
      pages.release(address);
      expect((await pages.response(new Request(`${address}/style.css`))).status).toBe(404);
    });

    it("gives no files and no base to a page without a folder, or to a page with its own base address", async () => {
      const pages = new FilePreviewPages();
      const folder = await reviewFolder();
      const plain = pages.add("text/html", html, pages.generation) ?? "";
      expect(await (await pages.response(new Request(plain))).text()).not.toContain("<base");
      expect((await pages.response(new Request(`${plain}/style.css`))).status).toBe(404);
      const own = new TextEncoder().encode('<head><base href="https://example.com/"></head><img src="a.png">');
      const based = pages.add("text/html", own, pages.generation, folder) ?? "";
      const text = await (await pages.response(new Request(based))).text();
      expect(text).not.toContain(`<base href="${based}/">`);
      expect(text).toContain('<base href="https://example.com/">');
      const target = new TextEncoder().encode('<head><base target="_blank"></head><img src="a.png">');
      const targeted = pages.add("text/html", target, pages.generation, folder) ?? "";
      expect(await (await pages.response(new Request(targeted))).text()).toContain(`<base href="${targeted}/">`);
    });
  });
});
