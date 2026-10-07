# OpenBot dev tree

This directory is the **only** place to change OpenBot source code.

| | Path |
| --- | --- |
| Dev clone | `/home/box/src/openbot-dev` |
| Origin | https://github.com/nightly-labs/openbot |
| Running app (do not edit) | `/home/box/apps/openbot` |

`/home/box/apps/openbot` is the installed AppImage (`OpenBot-0.29.0-x86_64.AppImage`, symlink `OpenBot.AppImage`) plus its extract under `squashfs-root/`. That tree is production. The live hunter (job-hunt schedules, login, `job-hunt-pack/`) runs from there.

Rules:

- Do not edit files under `/home/box/apps/openbot/squashfs-root`.
- Do not replace, move, or rebuild over the AppImage while a hunt is running.
- Do not point the running process at this clone.
- Skill and memory files under `/home/box/apps/openbot/job-hunt-pack/` are hunt data for the live app, not application source. Editing those does not change OpenBot code. Editing this clone does not change the live hunter.

How to build and run a dev build from this clone is **TBD**. Until that is written here, do not launch a second OpenBot from this tree against the same profile. Production stays on the AppImage so code changes in this clone cannot break the live hunter.

Installed release matched tag `v0.29.0` at clone time. This clone's `package.json` version string may still say `0.29.0` after `main` has moved past that tag; trust `git describe --tags` and `git log`, not only `package.json`.
