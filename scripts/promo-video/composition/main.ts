// The composition. `window.promo.seek(t)` draws the frame at `t` seconds; render.ts calls it once
// per frame and takes a screenshot. Open the page with `?play` to watch it with sound.

import { renderSoundtrack } from "./audio";
import { CUE, PROMISE_WORDS, PROVIDER_SWAPS, TRANSITIONS } from "./cues";
import { createHook } from "./scenes/hook";
import { createLocal } from "./scenes/local";
import { createModels } from "./scenes/models";
import { createOutro } from "./scenes/outro";
import { createPrice } from "./scenes/price";
import { createPromise } from "./scenes/promise";
import { createTeam } from "./scenes/team";
import { createStage, drawGridPulse, moveCamera, registerPromo, splitColor } from "./stage";
import { wavBase64 } from "./synth";
import { beatPulse, clamp, DURATION, decay, spring } from "./timeline";

/** Grid pulses: a bright ring runs out from the middle. */
const GRID_PULSES = [CUE.slam, CUE.price, CUE.outro] as const;

function sum(times: readonly number[], length: number, t: number): number {
  return times.reduce((total, at) => total + decay(t, at, length), 0);
}

async function build(): Promise<(t: number) => void> {
  const stage = await createStage((context) => [
    createHook(context),
    createPromise(context),
    createModels(context),
    createTeam(context),
    createLocal(context),
    createPrice(context),
    createOutro(context),
  ]);
  const { grid, glow, flash } = stage;

  return (t) => {
    stage.draw(t);

    // The grid comes on with the slam.
    const on = t >= CUE.slam;
    const snap = 1 + 0.35 * (1 - spring(t, CUE.slam, 2, 0.5));
    grid.style.opacity = on ? "1" : "0";
    grid.style.transform = `scale(${snap})`;
    grid.style.backgroundPosition = `50% calc(50% + ${t * 36}px)`;
    drawGridPulse(stage, t, GRID_PULSES, snap);
    glow.style.opacity = String(on ? 1 : 0);

    // Camera: a shake on the big hits and a small push on every beat of the groove.
    const shake =
      34 * decay(t, CUE.slam, 0.4) +
      16 * decay(t, CUE.price, 0.25) +
      24 * decay(t, CUE.outro, 0.35) +
      8 * decay(t, CUE.lock, 0.15) +
      5 * sum(PROMISE_WORDS, 0.12, t);
    moveCamera(stage, t, shake, 1 + 0.014 * beatPulse(t, 1.5, 14.5, 0.16));

    // The color split on the hits.
    splitColor(
      stage,
      16 * decay(t, CUE.slam, 0.35) +
        12 * decay(t, CUE.outro, 0.3) +
        8 * sum(TRANSITIONS, 0.15, t) +
        6 * decay(t, CUE.price, 0.2) +
        4 * sum(PROVIDER_SWAPS.slice(1), 0.08, t),
    );

    flash.style.opacity = String(
      clamp(
        Math.max(
          0.55 * decay(t, CUE.slam, 0.16),
          0.3 * decay(t, CUE.models, 0.14),
          0.25 * decay(t, CUE.team, 0.12),
          0.2 * decay(t, CUE.local, 0.12),
          0.4 * decay(t, CUE.price, 0.16),
          0.85 * decay(t, CUE.outro, 0.3),
        ),
      ),
    );
  };
}

registerPromo({
  duration: DURATION,
  build,
  soundtrack: async () => ({ buffer: await renderSoundtrack(), offset: 0 }),
  renderAudio: async () => wavBase64(await renderSoundtrack()),
});
