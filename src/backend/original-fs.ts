import * as nodeFs from "node:fs";
import { createRequire } from "node:module";

/**
 * Node's `fs` without Electron's archive support. In Electron, `fs` reads a `*.asar` file as a folder,
 * and a recursive `rm` of a folder that holds one never settles. An agent workspace can hold any file,
 * for example `node_modules/electron/dist/resources/default_app.asar` after a package install. Electron
 * keeps the unchanged module as `original-fs`. Bun and Node have no archive support, so they use `node:fs`.
 */
export const originalFs: typeof nodeFs = process.versions.electron
  ? createRequire(import.meta.url)("original-fs")
  : nodeFs;
