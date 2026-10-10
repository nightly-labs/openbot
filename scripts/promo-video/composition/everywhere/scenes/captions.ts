// Beats 2-19. One line over the device names each screen. The words come in a quarter beat apart,
// and the line goes up and out before the next screen.

import { html, show } from "../../dom";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../../scene";
import { ease, progress } from "../../timeline";
import { EVERYWHERE_COPY as COPY } from "../copy";
import { BEAT, CUE } from "../cues";

const Y = 122;
const SIZE = 86;
const SPACE = SIZE * 0.24;
const EXIT = 0.16;

export function createCaptions(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  const lines = [
    { words: COPY.captions[0], start: CUE.desktopCaption, end: CUE.browser },
    { words: COPY.captions[1], start: CUE.browserCaption, end: CUE.phone },
    { words: COPY.captions[2], start: CUE.phoneCaption, end: CUE.fly },
  ].map((line) => {
    const layer = html("div", "layer", root);
    const elements = line.words.map((text, index) => {
      const element = html("div", "word hero", layer, text);
      element.style.fontSize = `${SIZE}px`;
      // The screen is the last word.
      if (index === line.words.length - 1) element.style.color = "var(--promo-lilac)";
      return element;
    });
    const widths = elements.map((element) => element.offsetWidth);
    const total = widths.reduce((sum, width) => sum + width, 0) + SPACE * (widths.length - 1);
    let left = 960 - total / 2;
    const words = elements.map((element, index) => {
      const width = widths[index] ?? 0;
      const x = left + width / 2;
      left += width + SPACE;
      return { element, x };
    });
    return { layer, words, start: line.start, end: line.end };
  });

  return (t) => {
    for (const line of lines) {
      if (!show(line.layer, t >= line.start && t < line.end)) continue;
      const exit = ease.inCubic(progress(t, line.end - EXIT, EXIT));
      line.layer.style.transform = `translateY(${-40 * exit}px)`;
      line.layer.style.opacity = String(1 - exit);
      line.layer.style.filter = exit > 0.01 ? `blur(${18 * exit}px)` : "";
      for (const [index, word] of line.words.entries()) {
        punchIn(word.element, t, line.start + (index * BEAT) / 4, word.x, Y, { distance: 50, scale: 1.3 });
      }
    }
  };
}
