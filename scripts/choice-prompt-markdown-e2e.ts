// Builds and runs the choice-prompt Markdown harness. The harness is TypeScript with JSX, and Bun's
// own transpiler lowers JSX with the React runtime, so this script bundles it with the Solid Babel
// plugin and runs the bundle with the `solid` and `browser` conditions that the UI packages resolve
// through. Run: `bun scripts/choice-prompt-markdown-e2e.ts`.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import babel from "@babel/core";

// `Bun.build` reads `NODE_ENV` when the process starts, and the dev builds of `solid-js` and
// `@solidjs/web` print reactivity diagnostics for the prompt's transitions. Re-run once with the
// production builds, which are quiet, before building the harness.
if (process.env.NODE_ENV !== "production") {
  const rerun = spawnSync(process.execPath, [join(import.meta.dirname, "choice-prompt-markdown-e2e.ts")], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
  process.exit(rerun.status ?? 1);
}

const ROOT = resolve(import.meta.dirname, "..");
const HARNESS = join(ROOT, "scripts/choice-prompt-markdown-e2e-harness.tsx");
const OUT = join(ROOT, ".openbot-build/choice-prompt-markdown-e2e");

// Solid 2 lowers JSX to `template` and `insert` calls against `@solidjs/web`; Bun's transpiler
// lowers it with the React runtime. Every `.tsx` and `.jsx` in the graph goes through the Solid
// plugin. The `solid` condition makes `@kobalte/core`, `solid-sonner` and `lucide-solid` resolve to
// their JSX sources, and `browser` makes `@solidjs/web` resolve to its client build.
const solidJsx: Bun.BunPlugin = {
  name: "solid-jsx",
  setup(build) {
    const transform = (path: string, source: string, typescript: boolean) => {
      const options: babel.TransformOptions = {
        cwd: ROOT,
        filename: path,
        plugins: [["@solidjs/babel-plugin", { moduleName: "@solidjs/web" }]],
      };
      if (typescript) {
        options.presets = [["@babel/preset-typescript", { allExtensions: true, isTSX: true }]];
      }
      return babel.transformSync(source, options)?.code ?? "";
    };
    build.onLoad({ filter: /\.tsx$/ }, async (args) => ({
      contents: transform(args.path, await Bun.file(args.path).text(), true),
      loader: "js",
    }));
    build.onLoad({ filter: /\.jsx$/ }, async (args) => ({
      contents: transform(args.path, await Bun.file(args.path).text(), false),
      loader: "js",
    }));
  },
};

mkdirSync(OUT, { recursive: true });
const result = await Bun.build({
  entrypoints: [HARNESS],
  target: "node",
  format: "esm",
  conditions: ["solid", "browser"],
  external: ["jsdom", "node:*"],
  plugins: [solidJsx],
  outdir: OUT,
});
for (const log of result.logs) process.stdout.write(`${log}\n`);
if (!result.success) process.exit(1);
const bundle = result.outputs.find((output) => output.kind === "entry-point");
if (!bundle) {
  process.stderr.write("The Solid harness bundle was not produced.\n");
  process.exit(1);
}

const run = spawnSync(process.execPath, ["--conditions=solid", "--conditions=browser", bundle.path], {
  cwd: ROOT,
  env: { ...process.env, CHOICE_PROMPT_MARKDOWN_E2E_ROOT: ROOT },
  stdio: "inherit",
});
process.exit(run.status ?? 1);
