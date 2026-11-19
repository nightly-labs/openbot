import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import {
  automationContextId,
  frameAutomationContextId,
  recordValue,
  type SendCommand,
  stringValue,
} from "./browser-cdp-values";
import { stepText, USER_BROWSING_TEXT_CHARACTERS } from "./user-browsing-log";

/** A page that does not answer in this time gives no click step. */
export const CLICK_READ_TIMEOUT_MS = 1_000;
/** Frames inside frames. Past this a press gives no click step. */
const MAX_CLICK_FRAME_DEPTH = 8;
/** The automation-world global that keeps the frame element under the pointer for the next read. */
const CLICK_FRAME_GLOBAL = "__openbotClickFrame";

/**
 * Reads what is under the pointer in one frame, in CSS pixels, also inside an open shadow root. On a
 * frame element it keeps that element in `CLICK_FRAME_GLOBAL` and gives the offset of the frame's
 * content, so the read goes on in that frame. `byHover` finds the frame by `:hover` before the point,
 * which is not yet in this frame's pixels; without a point and a hovered frame it gives null. A click
 * outside a control gives null, so page text is not
 * recorded. It never reads what a person typed: a field gives its label, never its value, and an
 * editable area gives no name. A password field gives null.
 */
const clickScript = (point: { x: number; y: number } | null, byHover: boolean) => `(() => {
  const point = ${JSON.stringify(point)};
  const isFrame = (element) => element?.tagName === "IFRAME" || element?.tagName === "FRAME";
  let hit = null;
  if (${byHover}) {
    for (let scope = document; scope; ) {
      const hovered = scope.querySelectorAll(":hover");
      if (hovered.length === 0) break;
      hit = hovered[hovered.length - 1];
      scope = hit.shadowRoot;
    }
  }
  if (point && !isFrame(hit)) {
    hit = document.elementFromPoint(point.x, point.y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(point.x, point.y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
  }
  if (isFrame(hit)) {
    globalThis.${CLICK_FRAME_GLOBAL} = hit;
    const box = hit.getBoundingClientRect();
    const style = getComputedStyle(hit);
    return {
      frameLeft: box.left + hit.clientLeft + (parseFloat(style.paddingLeft) || 0),
      frameTop: box.top + hit.clientTop + (parseFloat(style.paddingTop) || 0),
    };
  }
  if (!point || !hit) return null;
  let target = null;
  for (let node = hit; node && !target; node = node.getRootNode().host || null)
    target = node.closest("a[href],button,input,select,textarea,summary,label,[role],[contenteditable]");
  if (!target) return null;
  const tag = target.tagName.toLowerCase();
  const type = (target.getAttribute("type") || "").toLowerCase();
  if (tag === "input" && type === "password") return null;
  if (/password|one-time-code|cc-/.test(target.getAttribute("autocomplete") || "")) return null;
  const inputRoles = { checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", image: "button", range: "slider", search: "searchbox" };
  const tagRoles = { a: "link", button: "button", select: "combobox", textarea: "textbox", summary: "button", label: "label" };
  const textRoles = ["link", "button", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "checkbox", "radio", "switch", "treeitem", "label"];
  const role = target.getAttribute("role") || (tag === "input" ? inputRoles[type] || "textbox" : tagRoles[tag]) || tag;
  const text = (value) => (value || "").replace(/\\s+/g, " ").trim();
  // An ID names an element of the same tree: the document, or the shadow root of the target.
  const tree = target.getRootNode();
  const byId = (id) => (typeof tree.getElementById === "function" ? tree : document).getElementById(id);
  const labelled = text((target.getAttribute("aria-labelledby") || "").split(/\\s+/).map((id) => byId(id)?.textContent || "").join(" "));
  const editable = target.isContentEditable || tag === "textarea" || (tag === "input" && !["checkbox", "radio", "button", "submit", "reset", "image", "range"].includes(type)) || tag === "select";
  const fieldLabel = () => text([...(target.labels || [])].map((label) => label.textContent).join(" ")) || text(target.getAttribute("placeholder"));
  // Only a button input shows its value as its name. A checkbox, a radio or a slider value is a field value.
  const valueNamed = tag === "input" && ["button", "submit", "reset"].includes(type);
  const name =
    text(target.getAttribute("aria-label")) ||
    labelled ||
    (editable || (tag === "input" && !valueNamed) ? fieldLabel() : "") ||
    (valueNamed ? text(target.value) : "") ||
    (!editable && textRoles.includes(role) ? text(target.innerText) : "") ||
    text(target.getAttribute("title")) ||
    text(target.getAttribute("alt"));
  return { role, name: name.slice(0, ${USER_BROWSING_TEXT_CHARACTERS * 2}) };
})()`;

/**
 * The role and the name of what a person pressed at `x`, `y` (CSS pixels), or null. `inPage` says
 * that the point is in the pixels of the page. Otherwise the press went to a frame in another process
 * and the point is in the pixels of that frame, so the read finds the frame by `:hover` first. Each
 * frame under the point is read in its own automation world: the page's own world cannot reach into a
 * frame of another origin. `frameSession` gives the session of a frame that runs in another process.
 */
export const readClickTarget = Effect.fn("Browser.readClickTarget")(function* (
  send: SendCommand,
  frameSession: (frameId: string) => string | undefined,
  x: number,
  y: number,
  inPage: boolean,
) {
  let sessionId: string | undefined;
  let contextId = yield* automationContextId(send);
  let point = inPage ? { x, y } : null;
  for (let depth = 0; depth <= MAX_CLICK_FRAME_DEPTH; depth += 1) {
    const expression = clickScript(point && { x: Math.round(point.x), y: Math.round(point.y) }, !inPage);
    const read = yield* send("Runtime.evaluate", { expression, contextId, returnByValue: true }, sessionId);
    const value = recordValue(read.result)?.value;
    if (!isDynamicRecord(value)) return null;
    if (!isNumber(value.frameLeft) || !isNumber(value.frameTop)) {
      if (!isString(value.role)) return null;
      const role = stepText(value.role);
      const name = isString(value.name) ? stepText(value.name) : "";
      return role ? { role, ...(name ? { name } : {}) } : null;
    }
    const owner = yield* send(
      "Runtime.evaluate",
      {
        expression: `(() => { const frame = globalThis.${CLICK_FRAME_GLOBAL}; globalThis.${CLICK_FRAME_GLOBAL} = null; return frame; })()`,
        contextId,
        returnByValue: false,
      },
      sessionId,
    );
    const objectId = stringValue(recordValue(owner.result)?.objectId);
    if (!objectId) return null;
    const described = yield* send("DOM.describeNode", { objectId }, sessionId);
    yield* send("Runtime.releaseObject", { objectId }, sessionId).pipe(Effect.ignore);
    const frameId = stringValue(recordValue(described.node)?.frameId);
    if (!frameId) return null;
    const inner = point && { x: point.x - value.frameLeft, y: point.y - value.frameTop };
    const frameSessionId = frameSession(frameId);
    if (frameSessionId === undefined) {
      contextId = yield* frameAutomationContextId(send, frameId, sessionId);
      point = inner;
    } else {
      sessionId = frameSessionId;
      contextId = yield* automationContextId(send, sessionId);
      // A press that went to a frame in another process is in the pixels of the last such frame.
      point = inPage ? inner : { x, y };
    }
  }
  return null;
});
