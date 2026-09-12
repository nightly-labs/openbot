# Camera transitions

Related to [#427](https://github.com/nightly-labs/openbot/issues/427) and
[#428](https://github.com/nightly-labs/openbot/issues/428).

## Decision

Keep Expo Camera for preview and capture, Reanimated for panel motion, and Skia for
the existing sign-in background. Do not add WebGPU for these transitions. The
camera is a native surface; replacing the decorative renderer does not remove
camera startup or native layout work.

Mount the camera at the requested preview size while the panel is hidden. Start
opening only after Expo Camera reports `onCameraReady`. Keep the same camera
mounted during motion. The QR scanner does not add a separate preview fade to
this opening. Chat expands its panel from the measured attachment button bounds
with Reanimated translation, scale, and opacity. The preview keeps fixed layout
dimensions during motion. A 300 ms spring without overshoot drives opening and
closing; close releases the camera after motion completes. If button measurement
is unavailable, the panel uses a short rise and scale instead. Reduced motion
omits translation and scale. Skia and WebGPU are not needed for this effect.

Keep the QR detector enabled from camera startup. In Expo Camera 57, the presence
of `onBarcodeScanned` controls `barcodeScannerEnabled`. Adding the callback after
opening causes the iOS implementation to add capture outputs with
`beginConfiguration` / `commitConfiguration` on the active session. This is a
possible source of a brief preview stall. Keep QR settings constant and ignore
scan results in application code until opening completes, or while a scan is
locked. Do not toggle native detection at those transitions.

This moves camera startup before the transition. It can add a delay between the
tap and the start of motion; it does not make camera hardware start faster. No
camera is kept running before the user requests it. Permission controls and
camera startup errors open without waiting for a live preview.

The sign-in background and logo pause when the scanner button is pressed, before
panel measurement and camera preparation. They resume after closing or a failed
measurement. The background stays paused while the QR panel is present. Its frame
callback also stops in the background and with reduced motion. If its Skia effect
cannot compile, the screen uses its plain background. Keep system reduced motion
on both panel animations.

The QR panel still changes its clip bounds during the morph. Profile that path
before replacing it with a transform or a canvas. This change does not tune photo
quality, preview resolution, or frame rate without device evidence.

## Verification

The existing scanner and chat camera tests cover camera preparation before opening,
scanning, close, camera switching, capture errors, and late capture results.
Scanner tests also cover background/resume and permission states. The new startup
checks fail when the panel opens before camera readiness.
They also check that native detection is enabled during preparation while early
scan results cannot start pairing. Both checks fail when their guards are removed.

No device performance measurements have been collected for this change. Test on
the slowest supported iPhone and Android phone with a release build, after explicit
permission for each build or device command. Use the same device and build mode
for baseline and changed code.

For each panel, record 20 open/close cycles, including the first cold camera start.
Measure tap-to-first-preview, frame times during opening, capture latency, and
memory after repeated cycles. Proposed acceptance targets: at least 95% of opening
frames within one display interval (16.7 ms at 60 Hz, 8.3 ms at 120 Hz), no opening
frame above 50 ms, and no sustained memory growth after camera release. Record
median and p95 preview/capture latency and tap-to-motion latency. Confirm that the
preview is live during opening on both platforms: readiness is a native camera
event, not a measurement of the first displayed frame.

Also check close during opening, reduced motion, denied permissions, camera
switching, background/resume, and light/dark appearance. Native interruption and
recovery, thermal load, and battery use remain part of the broader issue work.
For the chat morph, also check opening from the attachment menu with the keyboard
shown and hidden, and closing halfway through opening. Compare the source point
and final panel bounds on devices with different safe-area insets.
