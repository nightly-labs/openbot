// @vitest-environment node

import { describe, expect, it } from "vitest";
import { CHAT_VISUAL_PAGE_LIMIT } from "./chat-visual-protocol";
import { FilePreviewPages } from "./file-preview-pages";

const html = new TextEncoder().encode("<h1>Workspace report</h1><script>drawChart()</script>");

describe("workspace HTML preview pages", () => {
  it("serves only bytes registered by an authorized file preview, without accepting file paths", async () => {
    const pages = new FilePreviewPages();
    const address = pages.add("text/html", html, pages.generation);
    expect(address).toBeDefined();
    const page = pages.get(new URL(address ?? ""));
    expect(page).toEqual(html);
    const response = pages.response(new Request(address ?? ""));
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

  it("rejects non-GET page requests and unknown addresses through the protocol response", () => {
    const pages = new FilePreviewPages();
    const address = pages.add("text/html", html, pages.generation) ?? "";
    expect(pages.response(new Request(address, { method: "POST" })).status).toBe(404);
    expect(pages.response(new Request(`${address}?path=/private.html`)).status).toBe(404);
    pages.release(address);
    expect(pages.response(new Request(address)).status).toBe(404);
  });

  it("invalidates old addresses and restores capacity when the renderer is replaced", () => {
    const pages = new FilePreviewPages(1);
    for (let reload = 0; reload < 10; reload += 1) {
      const address = pages.add("text/html", html, pages.generation);
      expect(address).toBeDefined();
      expect(pages.response(new Request(address ?? "")).status).toBe(200);
      pages.clear();
      expect(pages.response(new Request(address ?? "")).status).toBe(404);
    }
  });

  it("rejects a late page from the old renderer without consuming the new renderer's capacity", () => {
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
    expect(pages.response(new Request(current ?? "")).status).toBe(200);
  });
});
