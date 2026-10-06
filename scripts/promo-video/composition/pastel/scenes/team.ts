// Beats 5-12. "Persistent AI teammates." Four agents pop in on sticker cards, one per half beat,
// and dance: each card hops on every other beat.

import { createAvatar } from "../../avatar";
import { html } from "../../dom";
import type { RenderScene } from "../../scene";
import { clamp } from "../../timeline";
import { PASTEL_COPY } from "../copy";
import { BEAT, CUE } from "../cues";
import { hop, placePose, pop } from "../motion";
import { createWord, memberOf } from "../parts";
import { createFloaters, type PastelContext } from "../stage";

const CARD = { width: 330, height: 420, step: 380, y: 650, avatar: 230 } as const;
const TITLE = { y: 230, size: 120, gap: 34 } as const;
/** Each card's color and tilt, like stickers. */
export const CARD_STYLES = [
  { color: "var(--pastel-sky)", tilt: -4 },
  { color: "var(--pastel-butter)", tilt: 3 },
  { color: "var(--pastel-pink)", tilt: -2 },
  { color: "var(--pastel-aqua)", tilt: 4 },
] as const;

export function createTeamCards(context: PastelContext): RenderScene {
  const { layer } = context;
  const floaters = createFloaters(layer, {
    seed: 23,
    start: CUE.wipeTeam,
    colors: ["var(--pastel-peach)", "var(--pastel-white)", "var(--pastel-butter)"],
  });
  const words = PASTEL_COPY.teamTitle.map((text) => createWord(layer, text, TITLE.size));
  const total = words.reduce((sum, word) => sum + word.width, 0) + TITLE.gap * (words.length - 1);

  const cards = PASTEL_COPY.messages.map((message, index) => {
    const member = memberOf(message.name);
    const style = CARD_STYLES[index % CARD_STYLES.length] ?? CARD_STYLES[0];
    const card = html("div", "pastel-card", layer);
    Object.assign(card.style, { width: `${CARD.width}px`, height: `${CARD.height}px`, background: style.color });
    const avatar = createAvatar(card, member.seed, member.hue, CARD.avatar);
    Object.assign(avatar.element.style, { left: `${(CARD.width - CARD.avatar) / 2}px`, top: "44px" });
    const label = html("div", "pastel-pill", card, message.name);
    Object.assign(label.style, {
      left: "50%",
      top: `${CARD.height - 104}px`,
      height: "70px",
      padding: "0 30px",
      transform: "translateX(-50%)",
      background: "var(--pastel-white)",
      fontSize: "32px",
      letterSpacing: "-0.02em",
    });
    return { card, avatar, tilt: style.tilt, x: 960 + (index - 1.5) * CARD.step, start: CUE.cards[index] ?? 0 };
  });

  // The dance: one hop per beat, with the cards taking turns.
  const beats: number[] = [];
  for (let beat = CUE.dance.from; beat <= CUE.dance.to + 0.001; beat += BEAT) beats.push(beat);

  return (t) => {
    floaters(t);
    let x = 960 - total / 2;
    words.forEach((word, index) => {
      word.render(t, CUE.teamTitle + index * BEAT, x + word.width / 2, TITLE.y);
      x += word.width + TITLE.gap;
    });
    cards.forEach((card, index) => {
      const { scaleX, scaleY } = pop(t, card.start, 2.4, 0.36);
      let lift = 0;
      let squashX = 1;
      let squashY = 1;
      beats.forEach((beat, step) => {
        if ((step + index) % 2 !== 0) return;
        const jump = hop(t, beat, BEAT * 0.8, 46);
        lift += jump.lift;
        squashX *= jump.scaleX;
        squashY *= jump.scaleY;
      });
      // A card swings its tilt the other way at the top of each hop.
      const swing = card.tilt * (1 - 2 * clamp(lift / 46));
      placePose(
        card.card,
        {
          x: card.x,
          y: CARD.y - lift,
          scaleX: scaleX * squashX,
          scaleY: scaleY * squashY,
          rotate: swing,
          opacity: clamp((t - card.start) * 10),
        },
        "50% 100%",
      );
      card.avatar.render(t);
    });
  };
}
