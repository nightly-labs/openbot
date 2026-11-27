import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { BrowserElement, BrowserSnapshot, BrowserTarget } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import {
  assertBeforeDeadline,
  automationContextId,
  axValue,
  type CdpResult,
  exceptionDescription,
  frameAutomationContextId,
  frameIds,
  isFrameGone,
  isRecord,
  numberValue,
  recordValue,
  type SendCommand,
  skipGoneFrame,
  stringValue,
  textMatches,
} from "./browser-cdp-values";
import { browserFailure, browserSync } from "./browser-effects";

const MAX_SNAPSHOT_ELEMENTS = 200;
const MAX_SNAPSHOT_CANDIDATES = MAX_SNAPSHOT_ELEMENTS * 2;
const MAX_SCANNED_TEXT = 100_000;
const MAX_SNAPSHOT_TEXT = 20_000;
export const MAX_SNAPSHOT_SCANNED_NODES = 10_000;
export const MAX_TARGET_CANDIDATES = 5;
const MAX_CANDIDATE_TEXT = 120;
const MAX_CANDIDATE_ITEM_TEXT = 200;
const MAX_CANDIDATE_PEERS = 500;
const MAX_SNAPSHOT_ELEMENT_VALUE = 2_000;
const MAX_FRAME_DOCUMENTS = 12;
const MAX_SERIALIZED_SNAPSHOT_BYTES = 128 * 1024;
type HiddenSubtreeRule = "strict" | "drawn" | "drawn-usable";

const SVG_RESOURCE_TAGS = [
  "clipPath",
  "defs",
  "filter",
  "linearGradient",
  "marker",
  "mask",
  "pattern",
  "radialGradient",
  "symbol",
];

function skipHiddenSubtrees(rule: HiddenSubtreeRule): string {
  const strict = rule === "strict";
  return `{ acceptNode: node => {
  if (node.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
  if (scanned >= ${MAX_SNAPSHOT_SCANNED_NODES}) return NodeFilter.FILTER_ACCEPT;
  let hidden = node.namespaceURI === 'http://www.w3.org/2000/svg' && ${JSON.stringify(SVG_RESOURCE_TAGS)}.includes(node.localName);
  hidden ||= Element.prototype.hasAttribute.call(node, 'hidden') || (${rule !== "drawn"} && Element.prototype.hasAttribute.call(node, 'inert')) || (${strict} && String(node.getAttribute('aria-hidden')).toLowerCase() === 'true');
  if (!hidden) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    hidden = !style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || (${strict} && style.opacity === '0');
  }
  if (hidden) {
    scanned++;
    return NodeFilter.FILTER_REJECT;
  }
  return NodeFilter.FILTER_ACCEPT;
} }`;
}

const SKIP_HIDDEN_SUBTREES = skipHiddenSubtrees("strict");

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
  targetId?: string | undefined;
  element: BrowserElement;
  visibleText: string;
  drawnOnly?: true;
  ownFrame?: true;
}

export interface SnapshotTarget {
  sessionId?: string;
  targetId?: string;
  url?: string;
}

export interface SemanticMatch {
  backendNodeId: number;
  sessionId?: string | undefined;
  targetId?: string | undefined;
  role: string;
  name: string;
}

export const collectBoundedSnapshot = Effect.fn("Browser.collectBoundedSnapshot")(function* (
  send: SendCommand,
  captures: SnapshotTarget[],
  revision: number,
  includeText: boolean,
  deadline?: number,
) {
  const strict = yield* collectSnapshotPass(send, captures, revision, includeText, false, deadline);
  if (!includeText || strict.elements.length > 0 || strict.text) return { ...strict, fallback: false };
  return { ...(yield* collectSnapshotPass(send, captures, revision, includeText, true, deadline)), fallback: true };
});

const collectSnapshotPass = Effect.fn("Browser.collectSnapshotPass")(function* (
  send: SendCommand,
  captures: SnapshotTarget[],
  revision: number,
  includeText: boolean,
  drawnOnly: boolean,
  deadline?: number,
) {
  const targets = new Map<string, TargetRecord>();
  const elements: BrowserElement[] = [];
  const textParts: string[] = [];
  let textLength = 0;
  let hasVisualSurface = false;
  let hasFrame = captures.length > 1;
  let hasRoot = true;
  let truncated = false;
  const documents: Array<{ capture: SnapshotTarget; contextId?: number }> = [];
  let frameBudget = MAX_FRAME_DOCUMENTS;
  for (const capture of captures) {
    documents.push({ capture });
    const frames = yield* frameDocumentContexts(send, capture.sessionId, frameBudget).pipe(
      Effect.catch(() => Effect.succeed([])),
    );
    frameBudget -= frames.length;
    documents.push(...frames.map((contextId) => ({ capture, contextId })));
  }
  for (const { capture, contextId } of documents) {
    yield* browserSync(() => assertBeforeDeadline(deadline));
    if (includeText) {
      const remainingText = Math.max(0, MAX_SNAPSHOT_TEXT - textLength);
      const summary = yield* collectPageSummaryEffect(
        send,
        capture.sessionId,
        remainingText,
        drawnOnly,
        contextId,
      ).pipe(Effect.catch(() => Effect.succeed(null)));
      if (summary) {
        if (summary.text) {
          textParts.push(summary.text);
          textLength += summary.text.length;
        }
        truncated ||= summary.truncated;
        hasVisualSurface ||= summary.hasVisualSurface;
        hasFrame ||= summary.hasFrame;
        if (!capture.sessionId && contextId === undefined) hasRoot = summary.hasRoot;
      }
    }
    const remainingElements = MAX_SNAPSHOT_ELEMENTS - elements.length;
    if (remainingElements <= 0) continue;
    const candidates =
      (capture.sessionId || contextId !== undefined) && deadline === undefined
        ? yield* collectActionableNodesEffect(send, capture, remainingElements, drawnOnly, undefined, contextId).pipe(
            Effect.catch(() => Effect.succeed([])),
          )
        : yield* collectActionableNodesEffect(send, capture, remainingElements, drawnOnly, deadline, contextId);
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
        name: candidate.name,
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
        ...(capture.targetId === undefined ? {} : { targetId: capture.targetId }),
        element,
        visibleText: candidate.visibleText,
        ...(drawnOnly ? { drawnOnly: true as const } : {}),
        ...(contextId === undefined ? {} : { ownFrame: true as const }),
      });
      if (elements.length >= MAX_SNAPSHOT_ELEMENTS) break;
    }
  }
  const text = textParts.join(" ").replace(/\s+/g, " ").trim();
  return {
    targets,
    elements,
    text: text.slice(0, MAX_SNAPSHOT_TEXT),
    truncated: truncated || text.length > MAX_SNAPSHOT_TEXT || elements.length >= MAX_SNAPSHOT_ELEMENTS,
    hasVisualSurface,
    hasFrame,
    hasRoot,
  };
});

const frameDocumentContexts = Effect.fn("Browser.frameDocumentContexts")(function* (
  send: SendCommand,
  sessionId: string | undefined,
  limit: number,
) {
  if (limit <= 0) return [];
  const tree = recordValue((yield* send("Page.getFrameTree", {}, sessionId)).frameTree);
  const frames: string[] = [];
  const pending = (Array.isArray(tree?.childFrames) ? tree.childFrames : []).map((child) => ({
    child: recordValue(child),
    parentOrigin: stringValue(recordValue(tree?.frame)?.securityOrigin),
  }));
  while (pending.length > 0 && frames.length < limit) {
    const next = pending.shift();
    const frame = recordValue(next?.child?.frame);
    const id = stringValue(frame?.id);
    const origin = stringValue(frame?.securityOrigin);
    if (id && origin !== next?.parentOrigin) frames.push(id);
    const children = next?.child?.childFrames;
    if (Array.isArray(children))
      pending.push(...children.map((child) => ({ child: recordValue(child), parentOrigin: origin })));
  }
  const contexts: number[] = [];
  for (const frameId of frames) {
    const contextId = yield* frameAutomationContextId(send, frameId, sessionId).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    );
    if (contextId !== undefined) contexts.push(contextId);
  }
  return contexts;
});

const collectPageSummaryEffect = Effect.fn("Browser.collectPageSummary")(function* (
  send: SendCommand,
  sessionId: string | undefined,
  maxText: number,
  drawnOnly: boolean,
  frameContextId?: number,
) {
  const contextId = frameContextId ?? (yield* automationContextId(send, sessionId));
  const result = yield* send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const maxNodes = ${MAX_SNAPSHOT_SCANNED_NODES};
        const maxText = ${maxText};
        const roots = [document];
        const seen = new Set();
        const inView = { parts: [], chars: 0 };
        const outside = { parts: [], chars: 0 };
        let truncated = false;
        let scanned = 0;
        let hasVisualSurface = false;
        let hasFrame = false;
        const visibleRects = node => {
          const range = node.ownerDocument.createRange();
          range.selectNodeContents(node);
          const rects = [...range.getClientRects()];
          return rects.length > 0 ? rects : null;
        };
        while (roots.length && scanned < maxNodes) {
          const root = roots.shift();
          if (!root || seen.has(root)) continue;
          seen.add(root);
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, ${skipHiddenSubtrees(drawnOnly ? "drawn" : "strict")});
          let node;
          while ((node = walker.nextNode()) && scanned < maxNodes) {
            scanned++;
            if (node.nodeType === Node.TEXT_NODE) {
              if (inView.chars >= maxText) {
                truncated = true;
                continue;
              }
              const parentTag = node.parentElement?.localName;
              if (parentTag === 'script' || parentTag === 'style' || parentTag === 'noscript' || parentTag === 'template') continue;
              const value = String(node.nodeValue || '').replace(/\\s+/g, ' ').trim();
              if (!value) continue;
              const rects = visibleRects(node);
              if (!rects) continue;
              const view = node.ownerDocument.defaultView;
              const width = view?.innerWidth ?? 0;
              const height = view?.innerHeight ?? 0;
              const target = rects.some(rect => rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width) ? inView : outside;
              if (target.chars >= maxText) {
                truncated = true;
                continue;
              }
              const part = value.slice(0, maxText - target.chars);
              if (part.length < value.length) truncated = true;
              target.parts.push(part);
              target.chars += part.length + 1;
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
        if (scanned >= maxNodes) truncated = true;
        const text = [...inView.parts, ...outside.parts].join(' ');
        if (text.length > maxText) truncated = true;
        return { text: text.slice(0, maxText), truncated, hasVisualSurface, hasFrame, hasRoot: document.documentElement !== null };
      })()`,
      contextId,
      returnByValue: true,
    },
    sessionId,
  );
  const value = recordValue(recordValue(result.result)?.value);
  return {
    text: stringValue(value?.text),
    truncated: value?.truncated === true,
    hasVisualSurface: value?.hasVisualSurface === true,
    hasFrame: value?.hasFrame === true,
    hasRoot: value?.hasRoot !== false,
  };
});

export const collectFocus = Effect.fn("Browser.collectFocus")(function* (send: SendCommand, sessionId?: string) {
  const contextId = yield* automationContextId(send, sessionId);
  const result = yield* send(
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
});

export const pageContainsText = Effect.fn("Browser.pageContainsText")(function* (
  send: SendCommand,
  captures: SnapshotTarget[],
  text: string,
  deadline: number,
) {
  for (const capture of captures) {
    yield* browserSync(() => assertBeforeDeadline(deadline));
    const scanBudgetMs = Math.max(1, deadline - Date.now());
    const contextId = yield* automationContextId(send, capture.sessionId).pipe(
      skipGoneFrame(capture.sessionId, undefined),
    );
    if (contextId === undefined) continue;
    const result = yield* send(
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
            const range = node.ownerDocument.createRange();
            range.selectNodeContents(node);
            return range.getClientRects().length > 0;
          };
          while (roots.length && scanned < ${MAX_SNAPSHOT_SCANNED_NODES} && chars < ${MAX_SCANNED_TEXT}) {
            if (performance.now() >= scanDeadline) return { matched: false, expired: true };
            const root = roots.shift();
            if (!root || seen.has(root)) continue;
            seen.add(root);
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, ${SKIP_HIDDEN_SUBTREES});
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
                  const part = value.slice(0, Math.max(0, ${MAX_SCANNED_TEXT} - chars));
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
    ).pipe(Effect.catch(() => Effect.succeed(null)));
    yield* browserSync(() => assertBeforeDeadline(deadline));
    const value = recordValue(recordValue(result?.result)?.value);
    if (value?.expired === true) return yield* browserFailure(new Error("Browser wait condition timed out."));
    if (value?.matched === true) return true;
  }
  return false;
});

export const cssObjectMatch = Effect.fn("Browser.cssObjectMatch")(function* (
  send: SendCommand,
  selector: string,
  sessionId?: string,
  limit = MAX_TARGET_CANDIDATES,
) {
  const contextId = yield* automationContextId(send, sessionId);
  const collection = yield* send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const selector = ${JSON.stringify(selector)};
        const roots = [document];
        const seen = new Set();
        const matches = [];
        let scanned = 0;
        let truncated = false;
        while (roots.length && matches.length < ${limit}) {
          const root = roots.shift();
          if (!root || seen.has(root)) continue;
          seen.add(root);
          for (const node of root.querySelectorAll(selector)) {
            matches.push(node);
            if (matches.length >= ${limit}) break;
          }
          if (truncated || matches.length >= ${limit}) continue;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          let node;
          while ((node = walker.nextNode())) {
            if (scanned >= ${MAX_SNAPSHOT_SCANNED_NODES}) {
              truncated = true;
              break;
            }
            scanned++;
            if (node.localName === 'iframe' || node.localName === 'frame') {
              try { if (node.contentDocument) roots.push(node.contentDocument); } catch {}
            }
            if (node.shadowRoot) roots.push(node.shadowRoot);
          }
        }
        if (truncated && matches.length === 0) throw new Error('CSS selector uniqueness scan exceeded the safe node limit.');
        return matches;
      })()`,
      contextId,
      returnByValue: false,
    },
    sessionId,
  );
  const exception = recordValue(collection.exceptionDetails);
  if (exception) return yield* browserFailure(new Error(exceptionDescription(exception)));
  return yield* collectionElements(send, stringValue(recordValue(collection.result)?.objectId), sessionId, limit);
});

const collectionElements = Effect.fn("Browser.collectionElements")(function* (
  send: SendCommand,
  collectionId: string,
  sessionId: string | undefined,
  limit = MAX_TARGET_CANDIDATES,
) {
  if (!collectionId) return [];
  return yield* Effect.gen(function* () {
    const properties = yield* send("Runtime.getProperties", { objectId: collectionId, ownProperties: true }, sessionId);
    return (Array.isArray(properties.result) ? properties.result.filter(isRecord) : [])
      .filter((descriptor) => /^\d+$/.test(stringValue(descriptor.name)))
      .sort((left, right) => Number(left.name) - Number(right.name))
      .map((descriptor) => stringValue(recordValue(descriptor.value)?.objectId))
      .filter(Boolean)
      .slice(0, limit);
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* send("Runtime.releaseObject", { objectId: collectionId }, sessionId).pipe(Effect.ignore);
      }).pipe(Effect.orDie),
    ),
  );
});

export const semanticAxMatches = Effect.fn("Browser.semanticAxMatches")(function* (
  send: SendCommand,
  capture: SnapshotTarget,
  target: Extract<BrowserTarget, { kind: "role" | "text" }>,
  allowNonActionableRole: boolean,
  deadline?: number,
  limit = MAX_TARGET_CANDIDATES,
) {
  yield* browserSync(() => assertBeforeDeadline(deadline));
  yield* send("Accessibility.enable", {}, capture.sessionId);
  const matches: SemanticMatch[] = [];
  const seen = new Set<number>();
  const frameTree = yield* send("Page.getFrameTree", {}, capture.sessionId);
  const ids = frameIds(frameTree);
  for (const frameId of ids) {
    const tree = yield* send("Accessibility.getFullAXTree", { frameId }, capture.sessionId).pipe(
      Effect.catchIf(
        (failure) => frameId !== ids[0] && isFrameGone(failure),
        () => Effect.succeed({ nodes: [] }),
      ),
    );
    yield* browserSync(() => assertBeforeDeadline(deadline));
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
        ...(capture.sessionId === undefined ? {} : { sessionId: capture.sessionId }),
        ...(capture.targetId === undefined ? {} : { targetId: capture.targetId }),
        role,
        name,
      });
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
});

export const visibleTextObjectMatches = Effect.fn("Browser.visibleTextObjectMatches")(function* (
  send: SendCommand,
  capture: SnapshotTarget,
  target: Extract<BrowserTarget, { kind: "text" }>,
  deadline?: number,
  limit = MAX_TARGET_CANDIDATES,
) {
  yield* browserSync(() => assertBeforeDeadline(deadline));
  const contextId = yield* automationContextId(send, capture.sessionId);
  const collection = yield* send(
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
          const explicitRole = (node.getAttribute('role') || '').trim().split(/\\s+/)[0].toLowerCase();
          const tag = node.localName;
          const semantic = tag === 'button' || tag === 'summary' || (tag === 'a' && node.hasAttribute('href')) ||
            tag === 'select' || tag === 'textarea' || (tag === 'input' && node.type !== 'hidden') || node.isContentEditable;
          if (!semantic && !roles.has(explicitRole)) return false;
          return node.getClientRects().length > 0;
        };
        while (roots.length && matches.length < ${limit}) {
          if (scanned >= ${MAX_SNAPSHOT_SCANNED_NODES}) {
            truncated = true;
            break;
          }
          const root = roots.shift();
          if (!root || seenRoots.has(root)) continue;
          seenRoots.add(root);
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, ${SKIP_HIDDEN_SUBTREES});
          while (matches.length < ${limit}) {
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
  if (exception) return yield* browserFailure(new Error(exceptionDescription(exception)));
  return yield* collectionElements(
    send,
    stringValue(recordValue(collection.result)?.objectId),
    capture.sessionId,
    limit,
  );
});

export interface TargetCandidateText {
  tag: string;
  text: string;
  item: string;
}

export const describeTargetCandidates = Effect.fn("Browser.describeTargetCandidates")(function* (
  send: SendCommand,
  sessionId: string | undefined,
  backendNodeIds: number[],
) {
  const executionContextId = yield* automationContextId(send, sessionId);
  const objectIds: string[] = [];
  return yield* Effect.gen(function* () {
    for (const backendNodeId of backendNodeIds) {
      const resolved = yield* send("DOM.resolveNode", { backendNodeId, executionContextId }, sessionId).pipe(
        Effect.catch(() => Effect.succeed<CdpResult>({})),
      );
      objectIds.push(stringValue(recordValue(resolved.object)?.objectId));
    }
    const resolvedIds = objectIds.filter(Boolean);
    const [first] = resolvedIds;
    if (!first) return [];
    const result = yield* send(
      "Runtime.callFunctionOn",
      {
        objectId: first,
        functionDeclaration: String.raw`function(...nodes) {
          const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
          const rendered = (element) =>
            element.checkVisibility ? element.checkVisibility() : element.getClientRects().length > 0;
          return nodes.map((node) => {
            if (!rendered(node)) return { tag: node.localName, text: '', item: '' };
            const text = clean(node.innerText);
            const own = clean(node.textContent);
            const twins = new Map();
            const isTwin = (peer) => {
              let known = twins.get(peer);
              if (known === undefined) {
                known = peer !== node && peer.childElementCount === node.childElementCount && clean(peer.textContent) === own;
                twins.set(peer, known);
              }
              return known;
            };
            const holdsTwin = (parent) => {
              const peers = parent.getElementsByTagName(node.localName);
              for (let index = 0; index < peers.length && index < ${MAX_CANDIDATE_PEERS}; index++) {
                if (isTwin(peers[index])) return true;
              }
              return false;
            };
            let item = '';
            for (let parent = node.parentElement, depth = 0; parent && depth < 8; parent = parent.parentElement, depth++) {
              if (nodes.some((other) => other !== node && parent.contains(other)) || holdsTwin(parent)) break;
              const parentText = clean(parent.innerText);
              if (parentText.length > ${MAX_CANDIDATE_ITEM_TEXT}) {
                if (!item) item = parentText;
                break;
              }
              if (parentText.length > text.length) item = parentText;
            }
            return { tag: node.localName, text: text.slice(0, ${MAX_CANDIDATE_TEXT}), item: item.slice(0, ${MAX_CANDIDATE_ITEM_TEXT}) };
          });
        }`,
        arguments: resolvedIds.map((objectId) => ({ objectId })),
        returnByValue: true,
      },
      sessionId,
    );
    const values = recordValue(result.result)?.value;
    const described = (Array.isArray(values) ? values.filter(isRecord) : []).map(
      (value): TargetCandidateText => ({
        tag: stringValue(value.tag),
        text: stringValue(value.text),
        item: stringValue(value.item),
      }),
    );
    let next = 0;
    return objectIds.map((objectId) => (objectId ? described[next++] : undefined));
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* Effect.all(
          objectIds
            .filter(Boolean)
            .map((objectId) => Effect.exit(send("Runtime.releaseObject", { objectId }, sessionId))),
          { concurrency: "unbounded" },
        );
      }).pipe(Effect.orDie),
    ),
  );
});

const collectActionableNodesEffect = Effect.fn("Browser.collectActionableNodes")(function* (
  send: SendCommand,
  capture: SnapshotTarget,
  limit: number,
  drawnOnly: boolean,
  deadline?: number,
  frameContextId?: number,
) {
  yield* browserSync(() => assertBeforeDeadline(deadline));
  yield* Effect.all([send("DOM.enable", {}, capture.sessionId), send("Accessibility.enable", {}, capture.sessionId)], {
    concurrency: "unbounded",
  });
  yield* browserSync(() => assertBeforeDeadline(deadline));
  const contextId = frameContextId ?? (yield* automationContextId(send, capture.sessionId));
  const results: Array<{
    backendNodeId: number;
    node: CdpResult;
    ax: CdpResult;
    role: string;
    name: string;
    visibleText: string;
  }> = [];
  const batchSize = MAX_SNAPSHOT_ELEMENTS;
  const collection = yield* send(
    "Runtime.evaluate",
    {
      expression: actionableNodesExpression(MAX_SNAPSHOT_CANDIDATES, drawnOnly ? "drawn-usable" : "strict"),
      contextId,
      returnByValue: false,
    },
    capture.sessionId,
  );
  const exception = recordValue(collection.exceptionDetails);
  if (exception) return yield* browserFailure(new Error(exceptionDescription(exception)));
  const collectionId = stringValue(recordValue(collection.result)?.objectId);
  if (!collectionId) return results;
  const objectIds: string[] = [];
  yield* Effect.gen(function* () {
    const properties = yield* send(
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
      const resolved = yield* Effect.all(
        batch.map((objectId) =>
          Effect.gen(function* () {
            const [description, partialAxTree, visibleTextResult] = yield* Effect.all(
              [
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
              ],
              { concurrency: "unbounded" },
            );
            const node = recordValue(description.node);
            const backendNodeId = numberValue(node?.backendNodeId);
            if (!node || !backendNodeId) return null;
            const axNodes = Array.isArray(partialAxTree.nodes) ? partialAxTree.nodes.filter(isRecord) : [];
            const ax =
              axNodes.find((candidate) => numberValue(candidate.backendDOMNodeId) === backendNodeId) ?? axNodes[0];
            if (!drawnOnly && (!ax || ax.ignored === true)) return null;
            const visibleText = stringValue(recordValue(visibleTextResult.result)?.value);
            const { role, name } = controlIdentity(node, ax, visibleText);
            if (!ACTIONABLE_ROLES.has(role)) return null;
            return { backendNodeId, node, ax: ax ?? {}, role, name, visibleText };
          }),
        ),
        { concurrency: "unbounded" },
      );
      results.push(...resolved.filter((candidate) => candidate !== null).slice(0, limit - results.length));
      yield* browserSync(() => assertBeforeDeadline(deadline));
    }
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* Effect.all(
          [
            ...objectIds.map((objectId) => send("Runtime.releaseObject", { objectId }, capture.sessionId)),
            send("Runtime.releaseObject", { objectId: collectionId }, capture.sessionId),
          ].map((operation) => Effect.exit(operation)),
          { concurrency: "unbounded" },
        );
      }).pipe(Effect.orDie),
    ),
  );
  return results;
});

function actionableNodesExpression(limit: number, rule: HiddenSubtreeRule): string {
  return `(() => {
    const roles = new Set(${JSON.stringify([...ACTIONABLE_ROLES])});
    const roots = [document];
    const seenRoots = new Set();
    const inView = [];
    const outside = [];
    let scanned = 0;
    const isInView = node => {
      const view = node.ownerDocument.defaultView;
      const width = view?.innerWidth ?? 0;
      const height = view?.innerHeight ?? 0;
      return [...node.getClientRects()].some(rect => rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width);
    };
    const isCandidate = node => {
      if (node.nodeType !== 1) return false;
      const explicitRole = (node.getAttribute('role') || '').trim().split(/\\s+/)[0].toLowerCase();
      const tag = node.localName;
      const semantic = tag === 'button' || tag === 'summary' || (tag === 'a' && node.hasAttribute('href')) ||
        tag === 'select' || tag === 'textarea' || (tag === 'input' && node.type !== 'hidden') || node.isContentEditable;
      if (!semantic && !roles.has(explicitRole)) return false;
      return node.getClientRects().length > 0;
    };
    const limit = ${Math.max(0, limit)};
    while (roots.length && scanned < ${MAX_SNAPSHOT_SCANNED_NODES} && inView.length < limit) {
      const root = roots.shift();
      if (!root || seenRoots.has(root)) continue;
      seenRoots.add(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, ${skipHiddenSubtrees(rule)});
      let node;
      while ((node = walker.nextNode()) && scanned < ${MAX_SNAPSHOT_SCANNED_NODES} && inView.length < limit) {
        scanned++;
        if (node.shadowRoot) roots.push(node.shadowRoot);
        if (node.localName === 'iframe' || node.localName === 'frame') {
          try { if (node.contentDocument) roots.push(node.contentDocument); } catch {}
        }
        if (!isCandidate(node)) continue;
        if (isInView(node)) inView.push(node);
        else if (outside.length < limit) outside.push(node);
      }
    }
    return [...inView, ...outside].slice(0, limit);
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
    if (snapshot.text.length > 0) {
      snapshot.truncated = true;
      const excess = bytes - MAX_SERIALIZED_SNAPSHOT_BYTES;
      snapshot.text = snapshot.text.slice(0, Math.max(0, snapshot.text.length - Math.max(1, excess)));
    } else if (snapshot.elements.length > 0) {
      snapshot.elements.pop();
      snapshot.truncated = true;
    } else if (snapshot.diagnostics.length > 0) snapshot.diagnostics.shift();
    else if (snapshot.actions.length > 0) snapshot.actions.shift();
    else throw new Error("Browser snapshot exceeds its serialized size limit.");
    bytes = Buffer.byteLength(JSON.stringify(snapshot));
  }
}

export function fallbackRole(node: CdpResult): string {
  const tag = (stringValue(node.localName) || stringValue(node.nodeName)).toLowerCase();
  const attributes = nodeAttributes(node.attributes);
  const role = (attributes.role ?? "").trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
  if (role && role !== "none" && role !== "presentation") return role;
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "a") return "link";
  if (tag === "select") return attributes.multiple === undefined ? "combobox" : "listbox";
  if (tag === "textarea" || attributes.contenteditable !== undefined) return "textbox";
  if (tag !== "input") return "";
  if (attributes.type === "checkbox") return "checkbox";
  if (attributes.type === "radio") return "radio";
  if (attributes.type === "range") return "slider";
  if (attributes.type === "number") return "spinbutton";
  if (["button", "submit", "reset", "image"].includes(attributes.type ?? "")) return "button";
  return "textbox";
}

export function controlIdentity(
  node: CdpResult,
  ax: CdpResult | undefined,
  visibleText: string,
): { role: string; name: string } {
  if (ax && ax.ignored !== true) {
    return { role: axValue(ax.role).toLowerCase() || fallbackRole(node), name: axValue(ax.name).slice(0, 500) };
  }
  const attributes = nodeAttributes(node.attributes);
  const role = fallbackRole(node);
  const value = stringValue(node.localName) === "input" && role === "button" ? attributes.value || attributes.alt : "";
  const name = attributes["aria-label"] || visibleText || value || attributes.placeholder || attributes.title || "";
  return { role, name: name.slice(0, 500) };
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

const HIDDEN_SECURITY_CODE = "•••";

export class CardValueScrub {
  readonly #numbers = new Map<string, { pattern: RegExp; replacement: string }>();
  #documentValues = new Map<string, RegExp>();
  #documentSecretShown = false;

  add(number: string, securityCode: string): void {
    const digits = number.replace(/[^0-9]/gu, "");
    if (digits.length >= 12 && !this.#numbers.has(digits)) {
      this.#numbers.set(digits, {
        pattern: new RegExp(`(?<![0-9])${[...digits].join("[\\s.\\-]*")}(?![0-9])`, "gu"),
        replacement: `•••• ${digits.slice(-4)}`,
      });
    }
    if (/^[0-9]{3,4}$/u.test(securityCode) && !this.#documentValues.has(securityCode))
      this.#documentValues.set(securityCode, new RegExp(`(?<![0-9])${securityCode}(?![0-9])`, "gu"));
  }

  addDocumentSecret(secret: string, shown: boolean): void {
    this.#documentSecretShown ||= shown;
    const forms = [secret, encodeURIComponent(secret), new URLSearchParams({ v: secret }).toString().slice(2)];
    for (const value of new Set(forms)) {
      if (!value || this.#documentValues.has(value)) continue;
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const pattern = /^[0-9]+$/u.test(value)
        ? `(?<![0-9])${escaped}(?![0-9])`
        : value.length < 4
          ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`
          : escaped;
      this.#documentValues.set(value, new RegExp(pattern, "gu"));
    }
  }

  endDocument(): void {
    this.#documentValues = new Map();
    this.#documentSecretShown = false;
  }

  get documentSecretShown(): boolean {
    return this.#documentSecretShown;
  }

  get active(): boolean {
    return this.#numbers.size > 0 || this.#documentValues.size > 0;
  }

  text(value: string): string {
    let result = value;
    for (const { pattern, replacement } of this.#numbers.values()) result = result.replace(pattern, replacement);
    for (const pattern of this.#documentValues.values()) result = result.replace(pattern, HIDDEN_SECURITY_CODE);
    return result;
  }

  reveals(value: string): boolean {
    return this.active && this.text(value) !== value;
  }

  snapshot(snapshot: BrowserSnapshot): BrowserSnapshot {
    if (!this.active) return snapshot;
    const scrubbed: BrowserSnapshot = JSON.parse(JSON.stringify(snapshot), (_key, value: unknown) =>
      typeof value === "string" ? this.text(value) : value,
    );
    boundSerializedSnapshot(scrubbed);
    return scrubbed;
  }
}
