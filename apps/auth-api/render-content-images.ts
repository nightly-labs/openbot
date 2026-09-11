// Draws the article artwork into the build cache, outside `vite build`.
//
// The build draws anything the cache is missing on its own, so this is never
// required. It exists so the slow, display-dependent part can run as a step of
// its own: in CI a failure then names this step instead of failing somewhere
// inside the bundler, and locally it warms the cache before a build.

import { contentImageJobs, renderContentImages } from "./content-images";

const started = Date.now();
const images = await renderContentImages((line) => console.log(line));
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`content-images: ${images.length} of ${contentImageJobs().length} images ready in ${seconds} s.`);
