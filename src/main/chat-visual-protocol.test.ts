import { isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { describe, expect, it } from "vitest";
import {
  attachmentCorsHeaders,
  attachmentDocumentHeaders,
  CHAT_VISUAL_PAGE_LIMIT,
  chatVisualResponse,
} from "./chat-visual-protocol";

const developmentUrl = "http://localhost:5173";

describe("visual reply pages", () => {
  it("serves the page in a sandbox with the frame script before the agent's script", async () => {
    const response = chatVisualResponse(new TextEncoder().encode("<html><head><script>agent()</script></head></html>"));
    expect(response.headers.get("Content-Security-Policy")).toBe("sandbox allow-scripts allow-forms");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const page = await response.text();
    expect(page.indexOf("ui/notifications/size-changed")).toBeLessThan(page.indexOf("agent()"));
  });

  it("does not serve a page above the limit", () => {
    expect(chatVisualResponse(new Uint8Array(CHAT_VISUAL_PAGE_LIMIT + 1)).status).toBe(404);
  });

  it("accepts only HTML", () => {
    expect(isChatVisualMimeType("text/html; charset=utf-8")).toBe(true);
    expect(isChatVisualMimeType("image/svg+xml")).toBe(false);
    expect(isChatVisualMimeType("text/plain")).toBe(false);
  });
});

describe("attachment scheme headers", () => {
  it("lets only the app read an attachment across origins", () => {
    expect(attachmentCorsHeaders(developmentUrl, developmentUrl)["Access-Control-Allow-Origin"]).toBe(developmentUrl);
    expect(attachmentCorsHeaders("openbot-app://app", undefined)["Access-Control-Allow-Origin"]).toBe(
      "openbot-app://app",
    );
    for (const origin of ["null", "openbot-visual://file", "https://example.com", null]) {
      expect(attachmentCorsHeaders(origin, developmentUrl)).not.toHaveProperty("Access-Control-Allow-Origin");
    }
  });

  it("opens an HTML or SVG attachment in a frame with no scripts", () => {
    expect(attachmentDocumentHeaders("text/html")).toEqual({ "Content-Security-Policy": "sandbox" });
    expect(attachmentDocumentHeaders("image/svg+xml")).toEqual({ "Content-Security-Policy": "sandbox" });
    expect(attachmentDocumentHeaders("application/pdf")).toEqual({});
  });
});
