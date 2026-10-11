import { createServer } from "node:http";
import { z } from "zod";

// All browser work stays on this real HTTP server. A receipt proves a submit occurred.
export async function startSite() {
  const receipts = new Map<string, string[]>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const id = url.searchParams.get("case") ?? "missing";
    if (url.pathname === "/receipts") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(receipts.get(id) ?? []));
      return;
    }
    if (url.pathname === "/submit") {
      const value = url.searchParams.get("value") ?? "";
      receipts.set(id, [...(receipts.get(id) ?? []), value]);
      response.setHeader("content-type", "text/plain");
      response.end(`Saved ${value}`);
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="en"><title>Release test form</title>
      <h1>Release test form</h1><p>Reference: 42</p>
      <form action="/submit"><label>Result <input name="value" required></label>
      <input type="hidden" name="case"><button>Save result</button></form>
      <script>document.querySelector('[name=case]').value = new URL(location.href).searchParams.get('case');</script>
      </html>`);
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      done();
    });
  });
  const port = z.object({ port: z.number() }).parse(server.address()).port;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done()))),
  };
}
