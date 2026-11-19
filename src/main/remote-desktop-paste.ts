export function remoteDesktopPasteScript(hostPlatform: "darwin" | "win32" | "linux"): string {
  const command = hostPlatform === "darwin" ? "Meta" : "Control";
  return `const COMMAND = ${JSON.stringify(`${command}Left`)};
const COMMAND_FLAG = ${JSON.stringify(command === "Meta" ? "metaKey" : "ctrlKey")};
const MODIFIERS = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);
const MAC_CLIENT = /Mac|iPhone|iPad/.test(navigator.platform);
const held = new Set();
let sent = null;
let queue = Promise.resolve();
const isPaste = (event) =>
  (MAC_CLIENT ? event.metaKey && !event.ctrlKey && !event.shiftKey : event.ctrlKey && !event.metaKey) &&
  !event.altKey &&
  (/^[a-z]$/i.test(event.key) ? event.key.toLowerCase() === "v" : event.code === "KeyV");
const press = (type, code, extra = {}) =>
  document.dispatchEvent(new KeyboardEvent(type, { code, key: code === "KeyV" ? "v" : code.replace(/(Left|Right)$/, ""), bubbles: true, cancelable: true, ...extra }));
addEventListener("keydown", (event) => {
  if (!event.isTrusted) return;
  if (MODIFIERS.has(event.code)) held.add(event.code);
  else if (isPaste(event)) event.stopImmediatePropagation();
}, true);
addEventListener("keyup", (event) => {
  if (event.isTrusted) held.delete(event.code);
}, true);
addEventListener("blur", () => held.clear());
addEventListener("paste", (event) => {
  event.stopImmediatePropagation();
  event.preventDefault();
  const text = event.clipboardData?.getData("text/plain") ?? "";
  const shift = [...held].find((code) => code.startsWith("Shift"));
  const flags = { [COMMAND_FLAG]: true, shiftKey: shift !== undefined };
  press("keydown", COMMAND, flags);
  for (const code of held) if (code !== COMMAND && !code.startsWith("Shift")) press("keyup", code, flags);
  queue = queue.then(async () => {
    let paste = true;
    if (text && text !== sent) {
      const response = await fetch("openbot-clipboard", { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: text }).catch(() => null);
      paste = response?.ok === true;
      if (paste) sent = text;
    }
    if (paste) {
      const pressShift = shift !== undefined && !held.has(shift);
      press("keydown", COMMAND, flags);
      if (pressShift) press("keydown", shift, flags);
      press("keydown", "KeyV", flags);
      press("keyup", "KeyV", flags);
      if (pressShift) press("keyup", shift, { [COMMAND_FLAG]: true });
    }
    if (!held.has(COMMAND)) press("keyup", COMMAND);
  });
}, true);
`;
}
