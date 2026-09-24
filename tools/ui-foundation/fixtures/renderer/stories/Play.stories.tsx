// Every line `no-story-play.grit` must reject ends in `// flag`. The other lines are correct
// story code the rule must leave alone.

export const Open = { args: { open: true }, play: async () => undefined }; // flag
export const Menu = { play: function () {} }; // flag
export const Reused = { play: Open.play }; // flag
export const Method = { play() {} }; // flag
export const AsyncMethod = { async play() {} }; // flag
Menu.play = async () => undefined; // flag

export const VideoArgs = { args: { play: true, onPlay: () => undefined } };
