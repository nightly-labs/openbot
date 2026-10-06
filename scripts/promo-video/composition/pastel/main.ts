// The pastel video: a light, bouncy pitch in the style of a friendly consumer app. The mark drops
// in, the team pops up on cards, works in #launch, takes any model, and the mark winks on the end
// card. Each scene floods in on a round wipe. Open the page with `?play` to watch it with sound.

import { registerPromo } from "../stage";
import { wavBase64 } from "../synth";
import { renderPastelSoundtrack } from "./audio";
import { CUE, PASTEL_DURATION } from "./cues";
import { createChat, STICKER } from "./scenes/chat";
import { createHello, HELLO_MASCOT } from "./scenes/hello";
import { createModels, HERO } from "./scenes/models";
import { createOutro } from "./scenes/outro";
import { createTeamCards } from "./scenes/team";
import { createPastelStage } from "./stage";

registerPromo({
  duration: PASTEL_DURATION,
  build: () =>
    createPastelStage([
      { create: createHello },
      {
        wipe: {
          at: CUE.wipeTeam,
          x: HELLO_MASCOT.x,
          y: HELLO_MASCOT.ground - HELLO_MASCOT.size / 2,
          color: "var(--pastel-cream)",
        },
        create: createTeamCards,
      },
      { wipe: { at: CUE.wipeChat, x: 960, y: 650, color: "var(--pastel-mint)" }, create: createChat },
      { wipe: { at: CUE.wipeModels, x: STICKER.x, y: STICKER.y, color: "var(--pastel-mist)" }, create: createModels },
      { wipe: { at: CUE.wipeOutro, x: HERO.x, y: HERO.y, color: "var(--pastel-lavender)" }, create: createOutro },
    ]),
  soundtrack: async () => ({ buffer: await renderPastelSoundtrack(), offset: 0 }),
  renderAudio: async () => wavBase64(await renderPastelSoundtrack()),
});
