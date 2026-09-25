import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { BrowserElement, BrowserFocus, BrowserSnapshot, BrowserTarget } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import {
  assertBeforeDeadline,
  automationContextId,
  axValue,
  type CdpResult,
  exceptionDescription,
  frameIds,
  isRecord,
  numberValue,
  recordValue,
  type SendCommand,
  stringValue,
  textMatches,
} from "./browser-cdp-values";

const MAX_SNAPSHOT_ELEMENTS = 200;
const MAX_SNAPSHOT_CANDIDATES = MAX_SNAPSHOT_ELEMENTS * 2;
const MAX_SNAPSHOT_TEXT = 100_000;
export const MAX_SNAPSHOT_SCANNED_NODES = 10_000;
const MAX_SNAPSHOT_ELEMENT_VALUE = 2_000;
const MAX_SERIALIZED_SNAPSHOT_BYTES = 1024 * 1024;

const ACTIONABLE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

export interface TargetRecord {
  backendNodeId: number;
  targetId?: string;
  element: BrowserElement;
  visibleText: string;
}

export interface SnapshotTarget {
  sessionId?: string;
  targetId?: string;
  url?: string;
}

export interface SemanticMatch {
  backendNodeId: number;
  sessionId?: string;
  targetId?: string;
  role: string;
  name: string;
}

export async function collectBoundedSnapshot(
  send: SendCommand,
  captures: SnapshotTarget[],
  revision: number,
  includeText: boolean,
  deadline?: number,
) {
  const targets = new Map<string, TargetRecord>();
  const elements: BrowserElement[] = [];
  const textParts: string[] = [];
  let textLength = 0;
  let hasVisualSurface = false;
  let hasFrame = captures.length > 1;
  for (const capture of captures) {
    assertBeforeDeadline(deadline);
    if (includeText) {
      const remainingText = Math.max(0, MAX_SNAPSHOT_TEXT - textLength);
      const summary = await collectPageSummary(send, capture.sessionId, remainingText).catch(() => null);
      if (summary) {
        if (summary.text) {
          textParts.push(summary.text);
          textLength += summary.text.length;
        }
        hasVisualSurface ||= summary.hasVisualSurface;
        hasFrame ||= summary.hasFrame;
      }
    }
    const remainingElements = MAX_SNAPSHOT_ELEMENTS - elements.length;
    if (remainingElements <= 0) break;
    const candidates =
      capture.sessionId && deadline === undefined
        ? await collectActionableNodes(send, capture, remainingElements).catch(() => [])
        : await collectActionableNodes(send, capture, remainingElements, deadline);
    for (const candidate of candidates) {
      const properties = Array.isArray(candidate.ax.properties) ? candidate.ax.properties.filter(isRecord) : [];
      const states = properties
        .filter((property) =>
          ["checked", "disabled", "expanded", "focused", "pressed", "readonly", "required", "selected"].includes(
            stringValue(property.name),
          ),
        )
        .map((property) => `${stringValue(property.name)}:${axValue(property.value)}`);
      const frameId = stringValue(candidate.node.frameId) || capture.targetId || "";
      const ref = `${revision}:${capture.targetId ?? "main"}:${candidate.backendNodeId}`;
      const element: BrowserElement = {
        ref,
        role: candidate.role,
        name: axValue(candidate.ax.name).slice(0, 500),
        description: axValue(candidate.ax.description).slice(0, 500),
        tag: (stringValue(candidate.node.localName) || stringValue(candidate.node.nodeName)).toLowerCase(),
        value: axValue(candidate.ax.value).slice(0, MAX_SNAPSHOT_ELEMENT_VALUE) || null,
        states,
        disabled: states.includes("disabled:true"),
        bounds: null,
        frame: frameId ? { id: frameId, url: redactedMetadataUrl(capture.url) } : null,
      };
      elements.push(element);
      targets.set(ref, {
        backendNodeId: candidate.backendNodeId,
        targetId: capture.targetId,
        element,
        visibleText: candidate.visibleText,
      });
      if (elements.length >= MAX_SNAPSHOT_ELEMENTS) break;
    }
  }
  return {
    targets,
    elements,
    text: textParts.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_SNAPSHOT_TEXT),
    hasVisualSurface,
    hasFrame,
  };
}

async function collectPageSummary(
  send: SendCommand,
  sessionId: string | undefined,
  maxText: number,
): Promise<{ text: string; hasVisualSurface: boolean; hasFrame: boolean }> {
  const contextId = await automationContextId(send, sessionId);
  const result = await send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const maxNodes = ${MAX_SNAPSHOT_SCANNED_NODES};
        const maxText = ${maxText};
        const roots = [document];
        const seen = new Set();
        const text = [];
        let chars = 0;
        let scanned = 0;
        let hasVisualSurface = false;
        let hasFrame = false;
        const isVisibleText = node => {
          let element = node.parentElement;
          while (element) {
            if (element.hidden || element.inert || String(element.getAttribute('aria-hidden')).toLowerCase() === 'true') return false;
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return false;
            const parent = element.parentElement;
            if (parent) element = parent;
            else {
              const root = element.getRootNode();
              element = root?.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root.host : null;
            }
          }
          const range = node.ownerDocument.createRange();
          range.selectNodeContents(node);
          return range.getClientRects().length > 0;
        };
        while (roots.length && scanned < maxNodes) {
          const root = roots.shift();
          if (!root || seen.has(root)) continue;
          seen.add(root);
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode()) && scanned < maxNodes) {
            scanned++;
            if (node.nodeType === Node.TEXT_NODE && chars < maxText) {
              const parentTag = node.parentElement?.localName;
              if (parentTag === 'script' || parentTag === 'style' || parentTag === 'noscript' || parentTag === 'template') continue;
              if (!isVisibleText(node)) continue;
              const value = String(node.nodeValue || '').replace(/\\s+/g, ' ').trim();
              if (value) {
                const part = value.slice(0, Math.max(0, maxText - chars));
                text.push(part);
                chars += part.length + 1;
              }
              continue;
            }
            if (node.nodeType !== 1) continue;
            const tag = node.localName;
            if (tag === 'canvas' || tag === 'video') hasVisualSurface = true;
            if (tag === 'iframe' || tag === 'frame') {
              hasFrame = true;
              try { if (node.contentDocument) roots.push(node.contentDocument); } catch {}
            }
            if (node.shadowRoot) roots.push(node.shadowRoot);
          }
        }
        return { text: text.join(' '), hasVisualSurface, hasFrame };
      })()`,
      contextId,
      returnByValue: true,
    },
    sessionId,
  );
  const value = recordValue(recordValue(result.result)?.value);
  return {
    text: stringValue(value?.text),
    hasVisualSurface: value?.hasVisualSurface === true,
    hasFrame: value?.hasFrame === true,
  };
}

// Focus is what `type` writes to when it has no target, and an application that draws its own
// surface keeps it on a node no semantic target names -- Google Sheets parks it on a hidden editor
// beside the grid, and on its Name box the moment that box was used. Without this a caller cannot
// tell the two apart until the data lands in the wrong place.
export async function collectFocus(send: SendCommand, sessionId?: string): Promise<BrowserFocus | null> {
  const contextId = await automationContextId(send, sessionId);
  const result = await send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        let node = document.activeElement;
        let inFrame = false;
        for (let depth = 0; depth < 10 && node; depth += 1) {
          const shadowed = node.shadowRoot?.activeElement;
          if (shadowed) { node = shadowed; continue; }
          let nested = null;
          try { nested = node.contentDocument?.activeElement ?? null; } catch {}
          if (!nested) break;
          inFrame = true;
          node = nested;
        }
        if (!node) return null;
        const tag = node.localName || '';
        const label = node.getAttribute?.('aria-label') || node.getAttribute?.('placeholder') || node.id || '';
        return {
          tag,
          role: node.getAttribute?.('role') || null,
          name: String(label).slice(0, 500),
          editable: node.isContentEditable === true || ['input', 'textarea', 'select'].includes(tag),
          inFrame,
        };
      })()`,
      contextId,
      returnByValue: true,
    },
    sessionId,
  );
  const value = recordValue(recordValue(result.result)?.value);
  if (!value) return null;
  return {
    tag: stringValue(value.tag),
    role: stringValue(value.role) || null,
    name: stringValue(value.name),
    editable: value.editable === true,
    inFrame: value.inFrame === true,
  };
}

export async function pageContainsText(
  send: SendCommand,
  captures: SnapshotTarget[],
  text: string,
  deadline: number,
): Promise<boolean> {
  for (const capture of captures) {
    assertBeforeDeadline(deadline);
    const scanBudgetMs = Math.max(1, deadline - Date.now());
    const contextId = await automationContextId(send, capture.sessionId);
    const result = await send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const needle = ${JSON.stringify(text)};
          const scanDeadline = performance.now() + ${scanBudgetMs};
          const roots = [document];
          const seen = new Set();
          let combined = '';
          let chars = 0;
          let scanned = 0;
          const isVisibleText = node => {
            let element = node.parentElement;
            while (element) {
              if (element.hidden || element.inert || String(element.getAttribute('aria-hidden')).toLowerCase() === 'true') return false;
              const style = getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return false;
              const parent = element.parentElement;
              if (parent) element = parent;
              else {
                const root = element.getRootNode();
                element = root?.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root.host : null;
              }
            }
            const range = node.ownerDocument.createRange();
            range.selectNodeContents(node);
            return range.getClientRects().length > 0;
          };
          while (roots.length && scanned < ${MAX_SNAPSHOT_SCANNED_NODES} && chars < ${MAX_SNAPSHOT_TEXT}) {
            if (performance.now() >= scanDeadline) return { matched: false, expired: true };
            const root = roots.shift();
            if (!root || seen.has(root)) continue;
            seen.add(root);
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode()) && scanned < ${MAX_SNAPSHOT_SCANNED_NODES}) {
              if (performance.now() >= scanDeadline) return { matched: false, expired: true };
              scanned++;
              if (node.nodeType === Node.TEXT_NODE) {
                const parentTag = node.parentElement?.localName;
                if (parentTag === 'script' || parentTag === 'style' || parentTag === 'noscript' || parentTag === 'template') continue;
                if (!isVisibleText(node)) continue;
                const value = String(node.nodeValue || '').replace(/\\s+/g, ' ').trim();
                if (value) {
                  const part = value.slice(0, Math.max(0, ${MAX_SNAPSHOT_TEXT} - chars));
                  combined += (combined ? ' ' : '') + part;
                  chars += part.length + 1;
                  if (combined.includes(needle)) return { matched: true, expired: false };
                }
                continue;
              }
              if (node.nodeType !== 1) continue;
              if ((node.localName === 'iframe' || node.localName === 'frame')) {
                try { if (node.contentDocument) roots.push(node.contentDocument); } catch {}
              }
              if (node.shadowRoot) roots.push(node.shadowRoot);
            }
          }
          return { matched: combined.includes(needle), expired: false };
        })()`,
        contextId,
        returnByValue: true,
      },
      capture.sessionId,
    ).catch(() => null);
    assertBeforeDeadline(deadline);
    const value = recordValue(recordValue(result?.result)?.value);
    if (value?.expired === true) throw new Error("Browser wait condition timed out.");
    if (value?.matched === true) return true;
  }
  return false;
}

export async function cssObjectMatch(
  send: SendCommand,
  selector: string,
  sessionId?: string,
): Promise<{ objectId?: string; ambiguous: boolean }> {
  const contextId = await automationContextId(send, sessionId);
  const collection = await send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const selector = ${JSON.stringify(selector)};
        const roots = [document];
        const seen = new Set();
        const matches = [];
        let scanned = 0;
        let truncated = false;
        while (roots.length && matches.length < 2) {
          if (scanned >= ${MAX_SNAPSHOT_SCANNED_NODES}) {
            truncated = true;
            break;
          }
          const root = roots.shift();
          if (!root || seen.has(root)) continue;
          seen.add(root);
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          while (matches.length < 2) {
            const node = walker.nextNode();
            if (!node) break;
            if (scanned >= ${MAX_SNAPSHOT_SCANNED_NODES}) {
              truncated = true;
              break;
            }
            scanned++;
            if (node.matches(selector)) matches.push(node);
            if (node.localName === 'iframe' || node.localName === 'frame') {
              try { if (node.contentDocument) roots.push(node.contentDocument); } catch {}
            }
            if (node.shadowRoot) roots.push(node.shadowRoot);
          }
          if (truncated) break;
        }
        if (truncated && matches.length < 2) throw new Error('CSS selector uniqueness scan exceeded the safe node limit.');
        return matches;
      })()`,
      contextId,
      returnByValue: false,
    },
    sessionId,
  );
  const exception = recordValue(collection.exceptionDetails);
  if (exception) throw new Error(exceptionDescription(exception));
  const collectionId = stringValue(recordValue(collection.result)?.objectId);
  if (!collectionId) return { ambiguous: false };
  try {
    const lengthResult = await send(
      "Runtime.callFunctionOn",
      {
        objectId: collectionId,
        functionDeclaration: "function() { return this.length; }",
        returnByValue: true,
      },
      sessionId,
    );
    const length = numberValue(recordValue(lengthResult.result)?.value);
    if (length === 0) return { ambiguous: false };
    if (length > 1) return { ambiguous: true };
    const element = await send(
      "Runtime.callFunctionOn",
      {
        objectId: collectionId,
        functionDeclaration: "function() { return this[0]; }",
        returnByValue: false,
      },
      sessionId,
    );
    const objectId = stringValue(recordValue(element.result)?.objectId);
    if (!objectId) throw new Error(`Unable to resolve CSS selector: ${selector}`);
    return { objectId, ambiguous: false };
  } finally {
    await send("Runtime.releaseObject", { objectId: collectionId }, sessionId).catch(() => undefined);
  }
}

export async function semanticAxMatches(
  send: SendCommand,
  capture: SnapshotTarget,
  target: Extract<BrowserTarget, { kind: "role" | "text" }>,
  allowNonActionableRole: boolean,
  deadline?: number,
): Promise<SemanticMatch[]> {
  assertBeforeDeadline(deadline);
  await send("Accessibility.enable", {}, capture.sessionId);
  const matches: SemanticMatch[] = [];
  const seen = new Set<number>();
  const frameTree = await send("Page.getFrameTree", {}, capture.sessionId);
  for (const frameId of frameIds(frameTree)) {
    const tree = await send("Accessibility.getFullAXTree", { frameId }, capture.sessionId);
    assertBeforeDeadline(deadline);
    for (const node of Array.isArray(tree.nodes) ? tree.nodes.filter(isRecord) : []) {
      if (node.ignored === true) continue;
      const backendNodeId = numberValue(node.backendDOMNodeId);
      const role = axValue(node.role).toLowerCase();
      if (!backendNodeId || seen.has(backendNodeId)) continue;
      seen.add(backendNodeId);
      const name = axValue(node.name).slice(0, 500);
      const description = axValue(node.description).slice(0, 500);
      const matched =
        target.kind === "role"
          ? (allowNonActionableRole || ACTIONABLE_ROLES.has(role)) &&
            role === target.role.toLowerCase() &&
            (!target.name || textMatches(name, target.name, target.exact))
          : ACTIONABLE_ROLES.has(role) &&
            [name, description].some((value) => textMatches(value, target.text, target.exact));
      if (!matched) continue;
      matches.push({
        backendNodeId,
        sessionId: capture.sessionId,
        targetId: capture.targetId,
        role,
        name,
      });
      if (matches.length >= 2) return matches;
    }
  }
  return matches;
}

export async function visibleTextObjectMatches(
  send: SendCommand,
  capture: SnapshotTarget,
  target: Extract<BrowserTarget, { kind: "text" }>,
  deadline?: number,
): Promise<string[]> {
  assertBeforeDeadline(deadline);
  const contextId = await automationContextId(send, capture.sessionId);
  const collection = await send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const roles = new Set(${JSON.stringify([...ACTIONABLE_ROLES])});
        const needle = ${JSON.stringify(target.text.trim().toLocaleLowerCase())};
        const exact = ${target.exact === true};
        const roots = [document];
        const seenRoots = new Set();
        const matches = [];
        let scanned = 0;
        let truncated = false;
        const isCandidate = node => {
          if (node.nodeType !== 1) return false;
          let element = node;
          while (element) {
            if (element.hidden || element.inert || String(element.getAttribute('aria-hidden')).toLowerCase() === 'true') return false;
            const style = element.ownerDocument.defaultView?.getComputedStyle(element);
            if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return false;
            const parent = element.parentElement;
            if (parent) element = parent;
            else {
              const root = element.getRootNode();
              element = root?.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root.host : null;
            }
          }
          const explicitRole = (node.getAttribute('role') || '').trim().split(/\\s+/)[0].toLowerCase();
          const tag = node.localName;
          const semantic = tag === 'button' || tag === 'summary' || (tag === 'a' && node.hasAttribute('href')) ||
            tag === 'select' || tag === 'textarea' || (tag === 'input' && node.type !== 'hidden') || node.isContentEditable;
          if (!semantic && !roles.has(explicitRole)) return false;
          return node.getClientRects().length > 0;
        };
        while (roots.length && matches.length < 2) {
          if (scanned >= ${MAX_SNAPSHOT_SCANNED_NODES}) {
            truncated = true;
            break;
          }
          const root = roots.shift();
          if (!root || seenRoots.has(root)) continue;
          seenRoots.add(root);
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          while (matches.length < 2) {
            const node = walker.nextNode();
            if (!node) break;
            if (scanned >= ${MAX_SNAPSHOT_SCANNED_NODES}) {
              truncated = true;
              break;
            }
            scanned++;
            if (node.shadowRoot) roots.push(node.shadowRoot);
            if (node.localName === 'iframe' || node.localName === 'frame') {
              try { if (node.contentDocument) roots.push(node.contentDocument); } catch {}
            }
            if (!isCandidate(node)) continue;
            const value = String(node.innerText ?? node.textContent ?? '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
            if (exact ? value === needle : value.includes(needle)) matches.push(node);
          }
          if (truncated) break;
        }
        if (truncated && matches.length < 2) throw new Error('Semantic target uniqueness scan exceeded the safe node limit.');
        return matches;
      })()`,
      contextId,
      returnByValue: false,
    },
    capture.sessionId,
  );
  const exception = recordValue(collection.exceptionDetails);
  if (exception) throw new Error(exceptionDescription(exception));
  const collectionId = stringValue(recordValue(collection.result)?.objectId);
  if (!collectionId) return [];
  try {
    const properties = await send(
      "Runtime.getProperties",
      { objectId: collectionId, ownProperties: true },
      capture.sessionId,
    );
    return (Array.isArray(properties.result) ? properties.result.filter(isRecord) : [])
      .filter((descriptor) => /^\d+$/.test(stringValue(descriptor.name)))
      .sort((left, right) => Number(left.name) - Number(right.name))
      .map((descriptor) => stringValue(recordValue(descriptor.value)?.objectId))
      .filter(Boolean)
      .slice(0, 2);
  } finally {
    await send("Runtime.releaseObject", { objectId: collectionId }, capture.sessionId).catch(() => undefined);
  }
}

async function collectActionableNodes(
  send: SendCommand,
  capture: SnapshotTarget,
  limit: number,
  deadline?: number,
): Promise<Array<{ backendNodeId: number; node: CdpResult; ax: CdpResult; role: string; visibleText: string }>> {
  assertBeforeDeadline(deadline);
  await Promise.all([send("DOM.enable", {}, capture.sessionId), send("Accessibility.enable", {}, capture.sessionId)]);
  assertBeforeDeadline(deadline);
  const contextId = await automationContextId(send, capture.sessionId);
  const results: Array<{
    backendNodeId: number;
    node: CdpResult;
    ax: CdpResult;
    role: string;
    visibleText: string;
  }> = [];
  const batchSize = MAX_SNAPSHOT_ELEMENTS;
  const collection = await send(
    "Runtime.evaluate",
    {
      expression: actionableNodesExpression(MAX_SNAPSHOT_CANDIDATES),
      contextId,
      returnByValue: false,
    },
    capture.sessionId,
  );
  const exception = recordValue(collection.exceptionDetails);
  if (exception) throw new Error(exceptionDescription(exception));
  const collectionId = stringValue(recordValue(collection.result)?.objectId);
  if (!collectionId) return results;
  const objectIds: string[] = [];
  try {
    const properties = await send(
      "Runtime.getProperties",
      { objectId: collectionId, ownProperties: true },
      capture.sessionId,
    );
    const descriptors = Array.isArray(properties.result) ? properties.result.filter(isRecord) : [];
    objectIds.push(
      ...descriptors
        .filter((descriptor) => /^\d+$/.test(stringValue(descriptor.name)))
        .sort((left, right) => Number(left.name) - Number(right.name))
        .map((descriptor) => stringValue(recordValue(descriptor.value)?.objectId))
        .filter(Boolean)
        .slice(0, MAX_SNAPSHOT_CANDIDATES),
    );
    for (let offset = 0; offset < objectIds.length && results.length < limit; offset += batchSize) {
      const batch = objectIds.slice(offset, offset + batchSize);
      const resolved = await Promise.all(
        batch.map(async (objectId) => {
          const [description, partialAxTree, visibleTextResult] = await Promise.all([
            send("DOM.describeNode", { objectId, depth: 0 }, capture.sessionId),
            send("Accessibility.getPartialAXTree", { objectId, fetchRelatives: false }, capture.sessionId),
            send(
              "Runtime.callFunctionOn",
              {
                objectId,
                functionDeclaration:
                  "function() { return String(this.innerText ?? this.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 500); }",
                returnByValue: true,
              },
              capture.sessionId,
            ),
          ]);
          const node = recordValue(description.node);
          const backendNodeId = numberValue(node?.backendNodeId);
          if (!node || !backendNodeId) return null;
          const axNodes = Array.isArray(partialAxTree.nodes) ? partialAxTree.nodes.filter(isRecord) : [];
          const ax =
            axNodes.find((candidate) => numberValue(candidate.backendDOMNodeId) === backendNodeId) ?? axNodes[0];
          if (!ax || ax.ignored === true) return null;
          const role = axValue(ax.role).toLowerCase() || fallbackRole(node);
          if (!ACTIONABLE_ROLES.has(role)) return null;
          return {
            backendNodeId,
            node,
            ax,
            role,
            visibleText: stringValue(recordValue(visibleTextResult.result)?.value),
          };
        }),
      );
      results.push(...resolved.filter((candidate) => candidate !== null).slice(0, limit - results.length));
      assertBeforeDeadline(deadline);
    }
  } finally {
    await Promise.allSettled([
      ...objectIds.map((objectId) => send("Runtime.releaseObject", { objectId }, capture.sessionId)),
      send("Runtime.releaseObject", { objectId: collectionId }, capture.sessionId),
    ]);
  }
  return results;
}

function actionableNodesExpression(limit: number): string {
  return `(() => {
    const roles = new Set(${JSON.stringify([...ACTIONABLE_ROLES])});
    const roots = [document];
    const seenRoots = new Set();
    const matches = [];
    let scanned = 0;
    const isCandidate = node => {
      if (node.nodeType !== 1) return false;
      let element = node;
      while (element) {
        if (element.hidden || element.inert || String(element.getAttribute('aria-hidden')).toLowerCase() === 'true') return false;
        const style = element.ownerDocument.defaultView?.getComputedStyle(element);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return false;
        const parent = element.parentElement;
        if (parent) element = parent;
        else {
          const root = element.getRootNode();
          element = root?.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root.host : null;
        }
      }
      const explicitRole = (node.getAttribute('role') || '').trim().split(/\\s+/)[0].toLowerCase();
      const tag = node.localName;
      const semantic = tag === 'button' || tag === 'summary' || (tag === 'a' && node.hasAttribute('href')) ||
        tag === 'select' || tag === 'textarea' || (tag === 'input' && node.type !== 'hidden') || node.isContentEditable;
      if (!semantic && !roles.has(explicitRole)) return false;
      return node.getClientRects().length > 0;
    };
    while (roots.length && scanned < ${MAX_SNAPSHOT_SCANNED_NODES} && matches.length < ${Math.max(0, limit)}) {
      const root = roots.shift();
      if (!root || seenRoots.has(root)) continue;
      seenRoots.add(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode()) && scanned < ${MAX_SNAPSHOT_SCANNED_NODES} && matches.length < ${Math.max(0, limit)}) {
        scanned++;
        if (node.shadowRoot) roots.push(node.shadowRoot);
        if (node.localName === 'iframe' || node.localName === 'frame') {
          try { if (node.contentDocument) roots.push(node.contentDocument); } catch {}
        }
        if (isCandidate(node)) matches.push(node);
      }
    }
    return matches;
  })()`;
}

function redactedMetadataUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, INPUT_LIMITS.browserUrl);
  } catch {
    return "";
  }
}

export function boundSerializedSnapshot(snapshot: BrowserSnapshot): void {
  let bytes = Buffer.byteLength(JSON.stringify(snapshot));
  while (bytes > MAX_SERIALIZED_SNAPSHOT_BYTES) {
    if (snapshot.diagnostics.length > 20) snapshot.diagnostics.shift();
    else if (snapshot.actions.length > 20) snapshot.actions.shift();
    else if (snapshot.elements.length > 0) snapshot.elements.pop();
    else if (snapshot.text.length > 0) {
      const excess = bytes - MAX_SERIALIZED_SNAPSHOT_BYTES;
      snapshot.text = snapshot.text.slice(0, Math.max(0, snapshot.text.length - Math.max(1, excess)));
    } else if (snapshot.diagnostics.length > 0) snapshot.diagnostics.shift();
    else if (snapshot.actions.length > 0) snapshot.actions.shift();
    else throw new Error("Browser snapshot exceeds its serialized size limit.");
    bytes = Buffer.byteLength(JSON.stringify(snapshot));
  }
}

export function fallbackRole(node: CdpResult): string {
  const tag = (stringValue(node.localName) || stringValue(node.nodeName)).toLowerCase();
  const attributes = nodeAttributes(node.attributes);
  if (attributes.role) return attributes.role.toLowerCase();
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "a") return "link";
  if (tag === "select") return attributes.multiple === undefined ? "combobox" : "listbox";
  if (tag === "textarea" || attributes.contenteditable !== undefined) return "textbox";
  if (tag !== "input") return "";
  if (attributes.type === "checkbox") return "checkbox";
  if (attributes.type === "radio") return "radio";
  if (attributes.type === "range") return "slider";
  if (attributes.type === "number") return "spinbutton";
  return "textbox";
}

function nodeAttributes(value: unknown): Record<string, string> {
  const raw = Array.isArray(value) ? value.filter(isString) : [];
  const result: Record<string, string> = {};
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index];
    const attribute = raw[index + 1];
    if (name !== undefined && attribute !== undefined) result[name.toLowerCase()] = attribute;
  }
  return result;
}
