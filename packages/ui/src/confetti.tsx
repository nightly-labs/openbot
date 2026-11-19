import { For, untrack } from "solid-js";

const CONFETTI_PIECES = 56;

/**
 * A burst of paper from the center of `origin`, or from the upper middle of the window when there is no
 * element. The layer covers the window, so that a dialog or a card does not clip it. Mount it once for
 * each burst. CSS hides it when the user prefers reduced motion.
 */
export function Confetti(props: { origin: Element | null | undefined }) {
  const origin = untrack(() => {
    const box = props.origin?.getBoundingClientRect();
    return {
      "--confetti-origin-x": `${box ? box.left + box.width / 2 : window.innerWidth / 2}px`,
      "--confetti-origin-y": `${box ? box.top + box.height / 2 : window.innerHeight / 3}px`,
    };
  });
  const pieces = Array.from({ length: CONFETTI_PIECES }, (_, index) => {
    const angle = (index / CONFETTI_PIECES) * Math.PI * 2 + Math.random() * 0.4;
    const reach = 140 + Math.random() * 180;
    return {
      "--confetti-x": `${Math.cos(angle) * reach}px`,
      "--confetti-y": `${Math.sin(angle) * reach * 0.7 - 90}px`,
      "--confetti-spin": `${Math.round(Math.random() * 720 - 360)}deg`,
      "--confetti-delay": `${Math.round(Math.random() * 120)}ms`,
      "--confetti-duration": `${Math.round(1_300 + Math.random() * 700)}ms`,
    };
  });
  return (
    <div class="ui-confetti" style={origin} aria-hidden="true">
      <For each={pieces}>{(style) => <i style={style} />}</For>
    </div>
  );
}
