import { defineMessages } from "../../../message";

export const messages = defineMessages("error.site", {
  // Hosted site errors.
  "error.site.absolutePath": "Choose an absolute site directory path.",
  "error.site.rootSymlink": "Symlinks are not allowed in hosted sites.",
  "error.site.notDirectory": "The site source must be a directory.",
  "error.site.outsideWorkspace": "The site must be inside this agent's workspace or OpenBot Shared.",
  "error.site.packageJsonInvalid": "The site package.json is invalid.",
  "error.site.astroServerOutput": "Astro must use static output.",
  "error.site.astroAdapter": "Astro server adapters and React integration are not allowed.",
  "error.site.astroApiRoutes": "Astro API routes and server actions are not allowed.",
  "error.site.astroMiddleware": "Astro middleware and server source are not allowed.",
  "error.site.astroNotBuilt": "Build the Astro project first. Its existing dist/ directory is required.",
  "error.site.astroDistNotDirectory": "Astro dist/ must be a real directory.",
  "error.site.astroDistOutside": "Astro dist/ must stay inside the project directory.",
  "error.site.directoryOutsideRoot": "Site directories must stay inside the source root.",
  "error.site.siteTooLarge": "The site exceeds the 2 MB limit.",
  "error.site.missingIndex": "The site root must contain index.html.",
  "error.site.symlink": "Symlinks are not allowed: {name}",
  "error.site.unsupportedEntry": "Unsupported site entry: {name}",
  "error.site.tooManyFiles": "A site can contain at most {limit} files.",
  "error.site.hiddenFile": "Hidden files are not allowed: {path}",
  "error.site.secretFile": "Credentials, private keys, and server source are not allowed: {path}",
  "error.site.fileType": "This file type is not allowed: {path}",
  "error.site.fileOutsideRoot": "Site files must stay inside the source root: {path}",
  "error.site.fileTooLarge": "A file exceeds the 1 MB limit: {path}",
});
