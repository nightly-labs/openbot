/** The steps of the model picker in the chat header, from the full picker to its icon. */
const MODEL_FIT: readonly string[] = ["full", "short", "icon"];

/**
 * Makes the model picker in a chat header smaller while `overflows` says that a part of the header
 * does not fit: without the effort, then as its icon. It gets larger again when the parts still fit
 * after the change. Each step is measured at its end size with the transitions off. Then the picker
 * slides to the new step, and `remeasure` runs when the slide ends.
 *
 * One part of the header fits the picker at a time: the thread tabs while they show, else the header.
 * Each fit starts from the step that the header shows, so a new owner continues from the last step.
 */
export function modelPickerFit(header: HTMLElement, overflows: () => boolean, remeasure: () => void) {
  let step = 0;
  let sliding = false;
  let released = false;
  const show = (next: number) => {
    step = next;
    if (next === 0) delete header.dataset.modelFit;
    else header.dataset.modelFit = MODEL_FIT[next];
  };
  const fitting = () => {
    while (step < MODEL_FIT.length - 1 && overflows()) show(step + 1);
    if (overflows()) return step;
    while (step > 0) {
      const current = step;
      show(current - 1);
      if (!overflows()) continue;
      show(current);
      break;
    }
    return step;
  };
  const fit = () => {
    // While the picker slides, its width is not final. The owner measures again after the slide.
    if (released || sliding) return;
    step = Math.max(0, MODEL_FIT.indexOf(header.dataset.modelFit ?? ""));
    const from = step;
    header.toggleAttribute("data-model-measure", true);
    const to = fitting();
    show(from);
    header.getBoundingClientRect();
    header.removeAttribute("data-model-measure");
    if (to === from) return;
    header.getBoundingClientRect();
    show(to);
    header.getBoundingClientRect();
    sliding = true;
    const slides = header.querySelector(".provider-model-trigger")?.getAnimations({ subtree: true }) ?? [];
    void Promise.allSettled(slides.map((slide) => slide.finished)).then(() => {
      sliding = false;
      if (!released) remeasure();
    });
  };
  /** The owner goes away. The step stays, so the next owner continues from it with no jump. */
  const stop = () => {
    released = true;
  };
  return { fit, stop };
}
