// One `GET {baseUrl}/models` request to an OpenAI-compatible server, made in main because the
// renderer's content security policy blocks a local address and a stored key must not go back to
// the page.
//
// An error names the host only. The path and the query of a base URL can hold a token, and the key
// and the header values are credentials, so no message and no log line contains them.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { CustomProviderHeader, DetectedModel } from "@openbot/contracts/ipc";
import { PROVIDER_DETECTION_LIMITS } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";

/** A model list is a small JSON object. A larger body is not a model list. */
export const MODEL_LIST_BODY_LIMIT = 1024 * 1024;

export interface ModelServerTarget {
  baseUrl: string;
  apiKey: string | null;
  headers: readonly CustomProviderHeader[];
}

export type ProbeModels = (target: ModelServerTarget, timeoutMs: number) => Promise<DetectedModel[]>;

/** The part of an address that an error may name. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "?";
  }
}

function modelsUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  return url;
}

/**
 * Asks the server for its models. Rejects with a translated message that names the host only.
 *
 * A redirect is refused, not followed: it could send the key to another origin, and a model server
 * has no reason to answer with one.
 */
export const probeModels: ProbeModels = async (target, timeoutMs) => {
  const host = hostOf(target.baseUrl);
  let url: URL;
  try {
    url = modelsUrl(target.baseUrl);
  } catch {
    throw new Error(sourceText("error.provider.baseUrlInvalid"));
  }
  const headers = new Headers({ Accept: "application/json" });
  for (const header of target.headers) headers.set(header.name, header.value);
  if (target.apiKey) headers.set("Authorization", `Bearer ${target.apiKey}`);

  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers, redirect: "manual", signal });
  } catch {
    throw new Error(
      signal.aborted
        ? sourceText("error.provider.discoveryTimeout", { host })
        : sourceText("error.provider.discoveryUnreachable", { host }),
    );
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error(sourceText("error.provider.discoveryRedirect", { host }));
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new Error(sourceText("error.provider.discoveryRefused", { host }));
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(sourceText("error.provider.discoveryHttp", { host, status: String(response.status) }));
  }
  const text = await readLimited(response, signal, host);
  return parseModelList(text, host);
};

async function readLimited(response: Response, signal: AbortSignal, host: string): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MODEL_LIST_BODY_LIMIT) {
    await response.body?.cancel();
    throw new Error(sourceText("error.provider.discoveryTooLarge", { host }));
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      throw new Error(
        signal.aborted
          ? sourceText("error.provider.discoveryTimeout", { host })
          : sourceText("error.provider.discoveryUnreachable", { host }),
      );
    }
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MODEL_LIST_BODY_LIMIT) {
      await reader.cancel();
      throw new Error(sourceText("error.provider.discoveryTooLarge", { host }));
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The OpenAI shape, `{ data: [{ id }] }`. An entry without a usable id is skipped, and a list longer
 * than the limit is cut: one odd model must not hide the others.
 */
function parseModelList(text: string, host: string): DetectedModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(sourceText("error.provider.discoveryInvalid", { host }));
  }
  if (!isDynamicRecord(parsed) || !Array.isArray(parsed.data)) {
    throw new Error(sourceText("error.provider.discoveryInvalid", { host }));
  }
  const seen = new Set<string>();
  const models: DetectedModel[] = [];
  for (const entry of parsed.data) {
    if (models.length >= PROVIDER_DETECTION_LIMITS.models) break;
    if (!isDynamicRecord(entry) || !isString(entry.id)) continue;
    const id = entry.id.trim();
    if (!id || id.length > INPUT_LIMITS.identifier || seen.has(id)) continue;
    seen.add(id);
    models.push({ id });
  }
  return models;
}
