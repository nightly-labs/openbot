# Gate F — The updater itself — `electron-builder.yml`, `src/main/update-service.ts`, `package.json`

Triggered by a change to any of those, to `package.json` dependencies, or to the two files that
enforce this gate at release time: `scripts/verify-update-artifacts.ts` and
`.github/workflows/release.yml`. A change that relaxes a size limit, drops a manifest or blockmap
check, or alters what gets published is exactly the change this gate should stop, and neither file
lives under the paths above — so without them listed, weakening the safeguard reads as "not
triggered". Diff the thresholds and the checks themselves, not only the code they guard.

- `appId`, the `publish` owner and repo, `artifactName` and `electronUpdaterCompatibility` are
  unchanged. A changed `appId` breaks the update feed and the `safeStorage` files at once — the
  users who lose their credentials are exactly the ones who successfully updated.
- **An `electron-updater` version bump means re-verifying the four non-public behaviours**
  documented on `UpdateAdapter` in `src/main/update-service.ts`: `MacUpdater.updateDownloaded` only
  asks Squirrel to stage while `autoInstallOnAppQuit` is on, `MacUpdater.quitAndInstall` stages on
  demand, every available check mints and returns a cancellation token, and
  `BaseUpdater.quitAndInstall` can return without quitting. Then update `VERIFIED_VERSION` in
  `src/main/electron-updater-assumptions.test.ts`. Retyping that version without re-verifying is
  the exact failure the test exists to catch, and issue #152 is what it cost last time.
- New `extraResources` or a bundled model breaks the size gates:
  `scripts/verify-update-artifacts.ts` rejects an update artifact over 700 MiB and a DMG over
  750 MiB, and `.github/workflows/release.yml` additionally rejects a macOS ZIP that is not smaller
  than the `v0.1.21` ZIP it downloads to compare against.

```bash
bun run test:desktop -- src/main/electron-updater-assumptions.test.ts
```
