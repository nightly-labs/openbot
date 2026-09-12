// One question, asked the same way everywhere: may this thing move? A reader who
// has asked their system for less motion gets a still picture, a stopped clip and
// no reveal, and each of those is a different component. The answer is only ever
// available in a browser, so a caller must ask after the page has settled.

export function motionWelcome(): boolean {
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
