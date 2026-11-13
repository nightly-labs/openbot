import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { WebContents } from "electron";
import { stepText, USER_BROWSING_TEXT_CHARACTERS } from "./user-browsing-log";

/** The isolated world of the click read, apart from the page's own scripts and the other OpenBot worlds. */
const CLICK_WORLD = 1_020;
/** A page that does not answer in this time gives no click step. */
const CLICK_READ_TIMEOUT_MS = 1_000;

/**
 * Reads the role and the name of the control under one point, in CSS pixels. A click outside a
 * control gives null, so page text is not recorded. It never reads what a person typed: a field gives
 * its label, never its value, and an editable area gives no name. A password field gives null.
 */
const clickScript = (x: number, y: number) => `(() => {
  const hit = document.elementFromPoint(${x}, ${y});
  if (!hit) return null;
  const target = hit.closest("a[href],button,input,select,textarea,summary,label,[role],[contenteditable]");
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
  const labelled = text((target.getAttribute("aria-labelledby") || "").split(/\\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "));
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

/** The role and the name of what a person clicked at `x`, `y` in view pixels, or null. */
export async function readClickTarget(
  contents: WebContents,
  x: number,
  y: number,
): Promise<{ role: string; name?: string } | null> {
  if (contents.isDestroyed()) return null;
  const zoom = contents.getZoomFactor() || 1;
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race<unknown>([
      contents.executeJavaScriptInIsolatedWorld(CLICK_WORLD, [
        { code: clickScript(Math.round(x / zoom), Math.round(y / zoom)) },
      ]),
      // On Linux the call does not return for a document whose navigation stopped.
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), CLICK_READ_TIMEOUT_MS);
      }),
    ]);
    if (!isDynamicRecord(value) || !isString(value.role)) return null;
    const role = stepText(value.role);
    const name = isString(value.name) ? stepText(value.name) : "";
    return role ? { role, ...(name ? { name } : {}) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
