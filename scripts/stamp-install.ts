import { writeInstallStamp } from "./prepare-dev-environment";

// The last root `postinstall` step, so it runs only after the other steps succeed. Without it, a
// plain `bun install` on another branch leaves the stamp of the old branch, and `bun run dev` then
// skips an install that it needs.
writeInstallStamp();
