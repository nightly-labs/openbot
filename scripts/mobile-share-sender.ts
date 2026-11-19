import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const ROOT = resolve(import.meta.dirname, "..");
const logger = createOpenBotLogger("mobile-share-sender");
const ENTRY = resolve(ROOT, "apps/mobile/src/features/share/extension/share-sender.ts");

const WITHOUT_SOURCE_TRANSLATIONS: Bun.BunPlugin = {
  name: "share-sender-without-source-translations",
  setup(build) {
    build.onLoad({ filter: /packages[\\/]i18n[\\/]src[\\/]source-catalogs\.ts$/ }, () => ({
      contents: "export function sourceTranslation() { return undefined; }",
      loader: "ts",
    }));
  },
};

const CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'unsafe-inline'; connect-src wss: ws:";

async function main(): Promise<void> {
  const output = process.argv[2];
  if (!output) throw new Error("Usage: bun scripts/mobile-share-sender.ts <output.html>");
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "browser",
    format: "iife",
    minify: true,
    plugins: [WITHOUT_SOURCE_TRANSLATIONS],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) {
    for (const message of result.logs) logger.error(String(message));
    throw new Error("The share sender page did not build.");
  }
  const [bundle] = result.outputs;
  if (!bundle) throw new Error("The share sender page has no output.");
  const script = (await bundle.text()).replaceAll("</script", "<\\/script");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}"></head><body><script>${script}</script></body></html>\n`;
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output), html);
}

await main();
