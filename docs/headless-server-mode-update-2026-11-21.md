# headless-server-mode — follow-up measurements (2026-11-21)

Companion notes for the `headless-server-mode` branch (PR
[nightly-labs/openbot#13808](https://github.com/nightly-labs/openbot/pull/13808),
issue [#13807](https://github.com/nightly-labs/openbot/issues/13807)).

These are measurements from the reporting host, not source changes. They are kept in
the fork so the case stays reproducible when upstream releases move on.

## Host

- POCO X7 Pro (MediaTek Dimensity 8400-Ultra, 12 GB RAM, Android 17, ColorOS 17).
- Packaged Linux arm64 build, `OPENBOT_SERVER=1`, `xvfb-run` (1280x800), started from
  Android's init through an Arch Linux ARM chroot at `/data/arch`, uid 0.
- UI is the Android app (`run.openbot.mobile`); no monitor, no desktop window.

Running this from native Termux would add a resident shell and its own runtime on top,
so the packaged path above is the lighter of the two on this device. The numbers below
are for the packaged path.

## Renderer patch (unchanged from the PR)

Measured with the app's own monitor (`~/.config/OpenBot/logs/resources.ndjson`, one
sample per minute, `rssMb` per category; idle samples, no tabs, startup dropped):

| | renderer loaded (0.74.0, 514 samples) | early return (0.75.0, 26 samples) |
| --- | --- | --- |
| app tree, no providers or tabs | p50 571 MB / p90 722 MB | p50 359 MB / p90 419 MB |
| window renderers | p50 232 MB | p50 73 MB |
| main process | p50 234 MB | p50 226 MB |
| processes | 10 | 9 |

- 212 MB less at p50 (-37%); CPU win is small at idle (~1% of one core, from
  `/proc/<pid>/stat` deltas over 150 s): the cost is memory and one Chromium process.
- Source of the second column: a size-preserving `app.asar` patch of `loadRenderer`
  with rehashed integrity fields, reapplied by `openbot-up` after every update because
  upstream does not have the fix yet.

## zram follow-up (new this turn)

The vendor memory extension (ColorOS "nandswap") fails on this host with `err=1004`.
Before zram was configured, `MemAvailable` collapsed to 50-170 MB (2026-11-20 21:15,
`/var/log/openbot-ram-peaks.csv`) with the vendor zram at ~11 GiB of 12 GiB. That is
when agent turns stalled; it is a host-level RAM collapse, not an OpenBot setting.

zram was then configured explicitly: 12 GiB, lz4, priority 100, no writeback device.
Measured 2026-11-21 on the same 0.75.0 host:

- `MemAvailable`: 1.52 GiB -> 3.41-3.7 GiB (+~1.9-2.2 GiB).
- zram 12 GiB, 3.1-3.5 GiB used, ratio ~3.3:1 (original 3.11 GiB -> compressed 0.95 GiB),
  cost ~0.98 GiB of RAM, net ~2.1 GiB freed.
- Per process: `opencode serve` ~382-388 MB (one process for all current agent sessions),
  `openbot.real` ~388-396 MB, main-window renderer ~108-117 MB again on the stock build.
- 11 agents registered, zero queued, no perceptible lag reported by the owner.

## Why both matter

zram keeps the host usable under load; the renderer patch stops OpenBot from spending
~212 MB on a window nobody sees. They are complementary, not substitutes: on a 2 GB
SBC or a phone, the renderer is the avoidable part of the app's own footprint.

## Keeping this branch current

This branch has one commit on top of upstream `main`. To follow upstream releases:

```
git fetch upstream
git rebase upstream/main
# edit notes here as new measurements arrive
git add docs/headless-server-mode-update-2026-11-21.md
git commit -m "docs: follow-up measurements"
git push --force-with-lease origin headless-server-mode
```

`--force-with-lease` is only for this branch after a rebase; no force push to `main` and
no destructive operation on other branches. The PR body is updated separately with
`gh pr edit 13808 -R nightly-labs/openbot --body-file ...`.
