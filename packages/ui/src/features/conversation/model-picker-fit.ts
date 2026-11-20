const MODEL_FIT: readonly string[] = ["full", "short", "icon"];

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
  const stop = () => {
    released = true;
  };
  return { fit, stop };
}
