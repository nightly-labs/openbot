/**
 * A joined server's browser for the MCP sign-in stories. It draws a server's consent page for each
 * sign-in the host opened, and a click on Allow stands in for the sign-in that the host took.
 */

import type { BrowserLiveViewEvent } from "@openbot/contracts/ipc";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import { createStore } from "solid-js";

const WIDTH = 1024;
const HEIGHT = 720;
const ALLOW = { x: 312, y: 452, width: 400, height: 56 };

interface Page {
  name: string;
  onAllow: () => void;
}

export function createSignInHost() {
  const listeners = new Set<(event: BrowserLiveViewEvent) => void>();
  const pagesByTab = new Map<string, Page>();
  const [pages, setPages] = createStore<Record<string, string>>({});
  let watching: string | null = null;
  let sequence = 0;

  const runtime: BrowserViewRuntime = {
    async startLiveView(tabId) {
      watching = tabId;
      const page = pagesByTab.get(tabId);
      if (!page) return;
      const image = await drawConsentPage(page.name);
      sequence += 1;
      for (const listener of listeners)
        listener({ type: "frame", tabId, sequence, width: WIDTH, height: HEIGHT, image });
    },
    stopLiveView: async () => {
      watching = null;
    },
    sendLiveViewInput: async (input) => {
      if (input.type !== "pointer" || input.action !== "down" || !watching) return;
      const x = input.x * WIDTH;
      const y = input.y * HEIGHT;
      const inside = x >= ALLOW.x && x <= ALLOW.x + ALLOW.width && y >= ALLOW.y && y <= ALLOW.y + ALLOW.height;
      if (inside) pagesByTab.get(watching)?.onAllow();
    },
    onLiveViewEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    runtime,
    /** The host tab of each sign-in page, by the address it signs in to. */
    pages,
    open(url: string, name: string, onAllow: () => void): string {
      const tabId = `sign-in-${url}`;
      pagesByTab.set(tabId, { name, onAllow });
      setPages((current) => {
        current[url] = tabId;
      });
      return tabId;
    },
    close(url: string): void {
      const tabId = pages[url];
      if (tabId) pagesByTab.delete(tabId);
      setPages((current) => {
        delete current[url];
      });
    },
  };
}

/** A server's consent page, the way the host's browser would show it. */
async function drawConsentPage(name: string): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#f6f6f4";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.roundRect(272, 120, 480, 440, 20);
    context.fill();
    context.textAlign = "center";
    context.fillStyle = "#1c1c1a";
    context.font = "600 34px sans-serif";
    context.fillText(name, WIDTH / 2, 210);
    context.font = "20px sans-serif";
    context.fillStyle = "#55554f";
    context.fillText("OpenBot wants to use your account.", WIDTH / 2, 268);
    context.fillText("Signed in as ada@example.com", WIDTH / 2, 300);
    context.strokeStyle = "#e2e2de";
    context.beginPath();
    context.moveTo(312, 352);
    context.lineTo(712, 352);
    context.stroke();
    context.fillText("Read your notes and meetings", WIDTH / 2, 402);
    context.fillStyle = "#1c1c1a";
    context.beginPath();
    context.roundRect(ALLOW.x, ALLOW.y, ALLOW.width, ALLOW.height, 12);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "600 20px sans-serif";
    context.fillText("Allow", WIDTH / 2, ALLOW.y + 35);
  }
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg" })).arrayBuffer());
}
