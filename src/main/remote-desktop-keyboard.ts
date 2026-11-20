const MODIFIER_CODES = [
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "CapsLock",
];

export function remoteDesktopKeyboardScript(): string {
  return `{
const MODIFIERS = new Set(${JSON.stringify(MODIFIER_CODES)});
const COMMANDS = new Set(["MetaLeft", "MetaRight", "OSLeft", "OSRight"]);
if (/Mac|iPhone|iPad/.test(navigator.platform)) {
  const held = new Map();
  const keyUp = (code, key) => document.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true, cancelable: true }));
  const release = (code) => {
    const key = held.get(code);
    held.delete(code);
    keyUp(code, key);
  };
  addEventListener("keydown", (event) => {
    if (!event.isTrusted || MODIFIERS.has(event.code)) return;
    const { code, key } = event;
    if (held.has(code) && !event.repeat) release(code);
    if (event.metaKey) {
      held.delete(code);
      setTimeout(() => keyUp(code, key));
    } else held.set(code, key);
  }, true);
  addEventListener("keyup", (event) => {
    if (!event.isTrusted) return;
    if (COMMANDS.has(event.code)) for (const code of [...held.keys()]) release(code);
    else held.delete(event.code);
  }, true);
  addEventListener("blur", () => held.clear());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") held.clear();
  });
}
}
`;
}
