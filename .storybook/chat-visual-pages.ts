import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/** The route where a story publishes a visual reply page and where the frame loads it. `ChatVisual.stories.tsx` uses it too. */
const CHAT_VISUAL_PAGES_ROUTE = "/__openbot/chat-visual";

/** A collage carries its images as data URLs, so a page can be a few megabytes. */
const PAGE_LIMIT = 8 * 1024 * 1024;

/**
 * Serves visual reply pages from a real URL with a sandbox policy, as the app will. A sandboxed
 * frame does not run the scripts of a `blob:` or `data:` page in every Chromium build, so a story
 * cannot use one. Pages are kept by content hash, so the set stays as small as the fixtures.
 */
export function chatVisualPages(): Plugin {
  const pages = new Map<string, Buffer>();
  return {
    name: "openbot-chat-visual-pages",
    configureServer(server) {
      server.middlewares.use(CHAT_VISUAL_PAGES_ROUTE, (request, response) => {
        if (request.method === "POST") {
          const chunks: Buffer[] = [];
          let size = 0;
          request.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size <= PAGE_LIMIT) chunks.push(chunk);
          });
          request.on("end", () => {
            if (size > PAGE_LIMIT) {
              response.statusCode = 413;
              response.end();
              return;
            }
            const page = Buffer.concat(chunks);
            const id = createHash("sha256").update(page).digest("hex").slice(0, 32);
            pages.set(id, page);
            response.setHeader("Content-Type", "text/plain; charset=utf-8");
            response.end(`${CHAT_VISUAL_PAGES_ROUTE}/${id}`);
          });
          return;
        }
        const page = pages.get((request.url ?? "").replace(/^\//u, "").split(/[?#]/u, 1)[0] ?? "");
        if (request.method !== "GET" || !page) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms");
        response.setHeader("Cache-Control", "no-store");
        response.end(page);
      });
    },
  };
}
