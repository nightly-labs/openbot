// A story that shows one visual state through its args and parameters, with no play function.

export const Open = { args: { open: true, play: false }, parameters: { layout: "fullscreen" } };
export const Narrow = { ...Open, parameters: { viewport: { defaultViewport: "narrow" } } };
