/**
 * A paste in the remote desktop viewer. Moonlight sends Cmd+V or Ctrl+V to the host as keys, so the
 * host pastes its own clipboard, not the member's. This script, which the gateway adds to the
 * viewer page, puts the member's text on the host's clipboard first, and then presses the host's
 * paste keys.
 *
 * Moonlight cancels each key it sends, and a cancelled key fires no paste event, so this script
 * keeps the V of a paste from Moonlight. Text that is already on the host's clipboard is not sent
 * again: a copy made on the host and pasted on the host stays the host's copy. With no text on the
 * member's clipboard, the keys still go, and the host pastes what it has.
 *
 * Sunshine holds the modifiers that Moonlight pressed, so a Ctrl from a Windows member would make a
 * Mac host see Ctrl+Cmd+V. The script releases the held modifiers other than Shift for the paste.
 */
export function remoteDesktopPasteScript(hostPlatform: "darwin" | "win32" | "linux"): string {
  const command = hostPlatform === "darwin" ? "Meta" : "Control";
  return `const COMMAND = ${JSON.stringify(`${command}Left`)};
const COMMAND_FLAG = ${JSON.stringify(command === "Meta" ? "metaKey" : "ctrlKey")};
const MODIFIERS = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);
// The member's own paste shortcut: Cmd+V on a Mac, Ctrl+V or Ctrl+Shift+V elsewhere. The other
// keys are keys the host may need, such as Ctrl+V in a terminal. Chrome on a Mac fires no paste
// event for Cmd+Shift+V, so that key goes to the host.
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
  // The host's paste key goes down now, before the member releases a key during the upload: a Win
  // or Super key released with no key since its press opens the Start menu or Activities. The
  // member's own paste key, when the host uses another one, is released for good. Shift stays in the
  // paste, also when the member releases it during the upload, so Ctrl+Shift+V still pastes in a
  // Linux terminal.
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
