---
name: record-demo
description: Record a short video of a change in the real local app and attach it to the pull request. Use after a UI change, a new flow, or motion, when the user writes `$record-demo`, or asks for a demo, a video, or a recording for a PR.
---

# Record demo

Drive the change in the local dev app while you record one page. Then
attach the `.webm` file to the PR. A video does not replace the `smoke`
test or CI.

## Before you start

- Read `AGENTS.md` and the `smoke` skill. Use its rules for the dev
  stack: `env -u ELECTRON_RUN_AS_NODE`, `bun run dev:status` first, reuse
  this worktree's stack, no `--shared`, never drive another worktree's app.
- When the change has no visible result, say so and stop.
- Recording needs the ffmpeg build of the installed Playwright. When
  `record` fails with `Executable doesn't exist at .../ffmpeg-<n>`, run
  `bun node_modules/playwright-core/cli.js install ffmpeg` once.

## Step 1 — Write the script

Write 3 to 8 steps that show the change from the start state to the
result. Use the `dev:automation` role and name of each control. Get them
from a `snapshot` before you record. Include the reverse action when the
change adds one. Keep the video under 60 s.

Do not show secrets, real user data, or a real account. A new worktree
profile already has showcase data; use it. Do not run `dev:seed` for a demo.

## Step 2 — Record

1. Bring the app to the state where the demo starts.
2. Start the recording with `run_in_background`:

   ```bash
   bun run dev:automation record --out=<name>.webm --duration=90000 --wait-for=<role>,<name>
   ```

   - Use a `<name>` with no `/`, so that the file stays at
     `.openbot-build/dev-automation/<name>.webm`.

   - `--page=<target-id|url-substring>` records another window or an
     embedded browser view. `--service=test-client` records the second
     client.
   - stderr prints `recording <w>x<h> ... stop with kill -INT <pid>`.
     Wait for this line before the first action.
3. Do the steps with `click` and `type`, each with `--wait-for`, as the
   `smoke` skill says. Keep about 1 s between steps so that a viewer can
   follow. One `sleep 1` between commands is permitted here: the pause is
   for the viewer, not for the app.
4. Stop: `kill -INT <pid>` with the PID from stderr. The command writes the
   file and prints `{"recording": "<path>", "durationMs": <n>}`. At the
   limit of `--duration` it stops by itself.

Other surfaces:

| Surface | Record with |
| --- | --- |
| Desktop app, test client | `bun run dev:automation record` |
| Browser client (`/app`), public web | The harness's preview recording tool, if it has one. Otherwise a temporary script under `.openbot-build/` with Playwright `page.screencast.start({ path })` |
| iOS simulator | `xcrun simctl io booted recordVideo --codec=h264 .openbot-build/<name>.mp4`, stop with `kill -INT <pid>` |

## Step 3 — Check the video

Do not attach a video that you did not check. Extract frames at the start,
middle, and end, and look at them. For example, open the file in Chrome
with Playwright, set `video.currentTime`, and take a screenshot of each
frame. Confirm:

- The result of the change is visible.
- No dialog, error, or empty loading state hides it.
- No secret, real name, email, or private path is visible.
- The file is less than 10 MB (GitHub's limit on the free plan).

When a check fails, record again. Do not edit the video.

## Step 4 — Attach to the PR

Use gh 2.101 or later (`gh --version`). Do not commit the video.

- New PR: add `--attach .openbot-build/dev-automation/<name>.webm` to
  `gh pr create`.
- Existing PR: `gh pr edit <pr> --attach .openbot-build/dev-automation/<name>.webm`.
  Without a body flag, gh keeps the body and appends the video.
- To put the video in `## Screenshots`, write
  `![demo](.openbot-build/dev-automation/<name>.webm)` there in the body
  file and pass `--body-file <file> --attach <same path>`. gh replaces the
  reference with the uploaded asset.

Open a PR only when the user asks. When there is no PR, give the file path.

## Step 5 — Clean up and report

- Stop each stack you started with `bun run dev:stop`. Leave a stack that
  was live before you started.
- Give the video path, its duration, the steps it shows, and the PR link
  when you attached it.
