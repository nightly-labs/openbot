import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CustomProviderHarness,
  CustomProviderInputKind,
  CustomProviderReasoningEffort,
  CustomProviderSummary,
  SaveCustomProviderInput,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import {
  AGENT_PROVIDERS,
  CUSTOM_PROVIDER_ID_PATTERN,
  CUSTOM_PROVIDER_INPUT_KINDS,
  CUSTOM_PROVIDER_LIMITS,
  CUSTOM_PROVIDER_REASONING_EFFORTS,
  composedCustomModelId,
  isAgentModel,
  isCustomProviderContextWindow,
  isCustomProviderHeaderName,
  isCustomProviderMaxOutput,
} from "@openbot/contracts/ipc";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { currentText } from "../../text";

export interface CustomModelDraft {
  id: string;
  name: string;
  contextWindow?: string;
  maxOutput?: string;
  reasoningEfforts?: CustomProviderReasoningEffort[];
  inputs?: CustomProviderInputKind[];
}

export interface CustomHeaderDraft {
  name: string;
  value: string;
  savedName?: string;
}

export interface CustomProviderDraft {
  providerId: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  models: CustomModelDraft[];
  headers: CustomHeaderDraft[];
  harness?: CustomProviderHarness;
}

export interface CustomProviderErrors {
  providerId?: string;
  displayName?: string;
  baseUrl?: string | undefined;
  apiKey?: string;
  models?: string;
  modelRows: (string | undefined)[];
  headerRows: (string | undefined)[];
}

export function emptyCustomProviderDraft(): CustomProviderDraft {
  return {
    providerId: "",
    displayName: "",
    baseUrl: "",
    apiKey: "",
    models: [{ id: "", name: "" }],
    headers: [{ name: "", value: "" }],
  };
}

export function savedHeaderDrafts(names: readonly string[] | undefined): CustomHeaderDraft[] {
  return names && names.length > 0
    ? names.map((name) => ({ name, value: "", savedName: name }))
    : [{ name: "", value: "" }];
}

export function savedCustomProviderDraft(
  provider: CustomProviderSummary,
  format: Pick<AppFormat, "number">,
): CustomProviderDraft {
  return {
    providerId: provider.id,
    displayName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: "",
    models:
      provider.models.length > 0
        ? provider.models.map((model) => ({
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow === undefined ? "" : tokenCountText(model.contextWindow, format),
            maxOutput: model.maxOutput === undefined ? "" : tokenCountText(model.maxOutput, format),
            ...(model.reasoningEfforts ? { reasoningEfforts: [...model.reasoningEfforts] } : {}),
            ...(model.inputs ? { inputs: [...model.inputs] } : {}),
          }))
        : [{ id: "", name: "" }],
    headers: savedHeaderDrafts(provider.headerNames),
    ...(provider.harness ? { harness: provider.harness } : {}),
  };
}

export function blankModel(model: CustomModelDraft): boolean {
  return (
    !model.id.trim() &&
    !model.name.trim() &&
    !model.contextWindow?.trim() &&
    !model.maxOutput?.trim() &&
    !model.reasoningEfforts?.length
  );
}

function tokenCount(text: string | undefined, inRange: (value: number) => boolean): number | null | undefined {
  const typed = text?.trim() ?? "";
  if (!typed) return undefined;
  if (!/^(?:\d+|\d{1,3}(?:([\s,._'’])\d{3})(?:\1\d{3})*)$/u.test(typed)) return null;
  const value = Number(typed.replace(/\D/gu, ""));
  return inRange(value) ? value : null;
}

export function tokenCountText(value: number, format: Pick<AppFormat, "number">): string {
  const text = format.number(value);
  return tokenCount(text, () => true) === value ? text : value.toString();
}

export function tokenCountEditText(text: string): string {
  const value = tokenCount(text, () => true);
  return typeof value === "number" ? value.toString() : text;
}

export function tokenCountRestText(text: string, format: Pick<AppFormat, "number">): string {
  const value = tokenCount(text, () => true);
  return typeof value === "number" ? tokenCountText(value, format) : text;
}

function contextWindowValue(model: CustomModelDraft): number | null | undefined {
  return tokenCount(model.contextWindow, isCustomProviderContextWindow);
}

function maxOutputValue(model: CustomModelDraft): number | null | undefined {
  return tokenCount(model.maxOutput, isCustomProviderMaxOutput);
}

function blankHeader(header: CustomHeaderDraft): boolean {
  return !header.name.trim() && !header.value.trim();
}

export function keepsHeaderValue(header: CustomHeaderDraft): boolean {
  return header.savedName !== undefined && header.name.trim() === header.savedName && !header.value.trim();
}

export function validateCustomProvider(
  draft: CustomProviderDraft,
  ids: { taken?: readonly string[] | undefined; locked?: boolean | undefined } = {},
  t: AppTranslate = currentText().t,
  format: AppFormat = currentText().format,
): CustomProviderErrors {
  const providerId = draft.providerId.trim();
  const errors: CustomProviderErrors = {
    modelRows: draft.models.map(() => undefined),
    headerRows: draft.headers.map(() => undefined),
  };

  if (!ids.locked) {
    if (!providerId) errors.providerId = t("customProvider.error.providerIdRequired");
    else if (!CUSTOM_PROVIDER_ID_PATTERN.test(providerId)) {
      errors.providerId = t("customProvider.error.providerIdPattern");
    } else if (providerId.length > INPUT_LIMITS.identifier) {
      errors.providerId = t("customProvider.error.providerIdLength", { max: INPUT_LIMITS.identifier });
    } else if (AGENT_PROVIDERS.some((provider) => provider === providerId)) {
      errors.providerId = t("customProvider.error.providerIdBuiltIn", { id: providerId });
    } else if (ids.taken?.includes(providerId)) {
      errors.providerId = t("customProvider.error.providerIdSaved", { id: providerId });
    }
  }

  const displayName = draft.displayName.trim();
  if (!displayName) errors.displayName = t("customProvider.error.displayNameRequired");
  else if (displayName.length > INPUT_LIMITS.agentName) {
    errors.displayName = t("customProvider.error.displayNameLength", { max: INPUT_LIMITS.agentName });
  }

  errors.baseUrl = baseUrlError(draft.baseUrl.trim(), t);

  if (draft.apiKey.length > CUSTOM_PROVIDER_LIMITS.apiKey) {
    errors.apiKey = t("customProvider.error.apiKeyLength", { max: CUSTOM_PROVIDER_LIMITS.apiKey });
  }

  const filled = draft.models.filter((model) => !blankModel(model));
  if (filled.length === 0) errors.models = t("customProvider.error.modelsRequired");
  else if (filled.length > CUSTOM_PROVIDER_LIMITS.models) {
    errors.models = t("customProvider.error.modelsLimit", { max: CUSTOM_PROVIDER_LIMITS.models });
  }

  const seen = new Set<string>();
  draft.models.forEach((model, index) => {
    if (blankModel(model)) return;
    const id = model.id.trim();
    if (!id) {
      errors.modelRows[index] = t("customProvider.error.modelIdRequired");
      return;
    }
    if (seen.has(id)) {
      errors.modelRows[index] = t("customProvider.error.modelIdDuplicate", { id });
      return;
    }
    seen.add(id);
    if (model.name.trim().length > INPUT_LIMITS.modelName) {
      errors.modelRows[index] = t("customProvider.error.displayNameLength", { max: INPUT_LIMITS.modelName });
      return;
    }
    if (contextWindowValue(model) === null) {
      errors.modelRows[index] = t("customProvider.error.contextWindowInvalid", {
        min: format.number(CUSTOM_PROVIDER_LIMITS.contextWindowMin),
        max: format.number(CUSTOM_PROVIDER_LIMITS.contextWindowMax),
      });
      return;
    }
    if (maxOutputValue(model) === null) {
      errors.modelRows[index] = t("customProvider.error.maxOutputInvalid", {
        min: format.number(CUSTOM_PROVIDER_LIMITS.maxOutputMin),
        max: format.number(CUSTOM_PROVIDER_LIMITS.maxOutputMax),
      });
      return;
    }
    if (model.maxOutput?.trim() && contextWindowValue(model) === undefined) {
      errors.modelRows[index] = t("customProvider.error.maxOutputNeedsWindow");
      return;
    }
    if (!errors.providerId && !isAgentModel(composedCustomModelId(providerId, id))) {
      errors.modelRows[index] = t("customProvider.error.modelIdInvalid");
    }
  });

  const headerNames = new Set<string>();
  draft.headers.forEach((header, index) => {
    if (blankHeader(header)) return;
    const name = header.name.trim();
    if (!name) errors.headerRows[index] = t("customProvider.error.headerNameRequired");
    else if (!isCustomProviderHeaderName(name)) errors.headerRows[index] = t("customProvider.error.headerNameInvalid");
    else if (headerNames.has(name.toLowerCase()))
      errors.headerRows[index] = t("customProvider.error.headerDuplicate", { name });
    else if (!header.value.trim() && !keepsHeaderValue(header))
      errors.headerRows[index] = t("customProvider.error.headerValueRequired");
    else headerNames.add(name.toLowerCase());
  });
  if (draft.headers.filter((header) => !blankHeader(header)).length > CUSTOM_PROVIDER_LIMITS.headers) {
    errors.headerRows[CUSTOM_PROVIDER_LIMITS.headers] = t("customProvider.error.headersLimit", {
      max: CUSTOM_PROVIDER_LIMITS.headers,
    });
  }

  return errors;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function endpointUrlError(url: string, t: AppTranslate = currentText().t): string | undefined {
  return baseUrlError(url.trim(), t);
}

function baseUrlError(baseUrl: string, t: AppTranslate): string | undefined {
  if (!baseUrl) return t("customProvider.error.baseUrlRequired");
  if (baseUrl.length > CUSTOM_PROVIDER_LIMITS.baseUrl) {
    return t("customProvider.error.baseUrlLength", { max: CUSTOM_PROVIDER_LIMITS.baseUrl });
  }
  const parsed = parseUrl(baseUrl);
  if (!parsed) return t("customProvider.error.baseUrlInvalid", { example: "http://127.0.0.1:11434/v1" });
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return t("customProvider.error.baseUrlProtocol");
  if (parsed.username || parsed.password) return t("customProvider.error.baseUrlCredential");
  return undefined;
}

export function hasCustomProviderError(errors: CustomProviderErrors): boolean {
  return Boolean(
    errors.providerId ||
      errors.displayName ||
      errors.baseUrl ||
      errors.apiKey ||
      errors.models ||
      errors.modelRows.some(Boolean) ||
      errors.headerRows.some(Boolean),
  );
}

export function customProviderValue(draft: CustomProviderDraft): SaveCustomProviderInput {
  const models = draft.models
    .filter((model) => !blankModel(model))
    .map((model) => {
      const id = model.id.trim();
      const name = model.name.trim() || id;
      const contextWindow = contextWindowValue(model);
      const maxOutput = maxOutputValue(model);
      const reasoningEfforts = CUSTOM_PROVIDER_REASONING_EFFORTS.filter((effort) =>
        model.reasoningEfforts?.includes(effort),
      );
      const inputs = model.inputs && CUSTOM_PROVIDER_INPUT_KINDS.filter((kind) => model.inputs?.includes(kind));
      return {
        id,
        name,
        ...(typeof contextWindow === "number" ? { contextWindow } : {}),
        ...(typeof maxOutput === "number" ? { maxOutput } : {}),
        ...(model.reasoningEfforts ? { reasoningEfforts } : {}),
        ...(inputs ? { inputs } : {}),
      };
    });
  return {
    id: draft.providerId.trim(),
    name: draft.displayName.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim() || null,
    models,
    headers: draft.headers
      .filter((header) => !blankHeader(header))
      .map((header) => ({ name: header.name.trim(), value: header.value.trim() })),
    ...(draft.harness ? { harness: draft.harness } : {}),
  };
}

export function customProviderUpdate(value: SaveCustomProviderInput): UpdateCustomProviderInput {
  return {
    id: value.id,
    name: value.name,
    baseUrl: value.baseUrl,
    models: value.models,
    ...(value.apiKey === null ? {} : { apiKey: value.apiKey }),
    headers: value.headers.map((header) => ({ name: header.name, value: header.value || null })),
    ...(value.harness ? { harness: value.harness } : {}),
  };
}

export interface CustomProviderEndpoint {
  baseUrl: string;
  apiKey: string | null;
  headers: CustomHeaderDraft[];
  savedProviderId?: string;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutput?: number;
  reasoningEfforts?: CustomProviderReasoningEffort[];
  inputs?: CustomProviderInputKind[];
}

export function holdsFoundValues(row: CustomModelDraft, found: DiscoveredModel): boolean {
  const window = found.contextWindow !== undefined && contextWindowValue(row) === found.contextWindow;
  const inputs = found.inputs !== undefined && row.inputs?.join() === found.inputs.join();
  const efforts =
    found.reasoningEfforts !== undefined && row.reasoningEfforts?.join() === found.reasoningEfforts.join();
  return window || inputs || efforts;
}

export function fillFoundValues(
  row: CustomModelDraft,
  found: DiscoveredModel,
  format: Pick<AppFormat, "number">,
): void {
  if (!row.contextWindow?.trim() && found.contextWindow !== undefined) {
    row.contextWindow = tokenCountText(found.contextWindow, format);
  }
  const window = contextWindowValue(row);
  if (
    !row.maxOutput?.trim() &&
    typeof window === "number" &&
    found.maxOutput !== undefined &&
    found.maxOutput < window
  ) {
    row.maxOutput = tokenCountText(found.maxOutput, format);
  }
  if (row.inputs === undefined && found.inputs !== undefined) row.inputs = [...found.inputs];
  if (row.reasoningEfforts === undefined && found.reasoningEfforts !== undefined) {
    row.reasoningEfforts = [...found.reasoningEfforts];
  }
}

export type ModelDiscovery =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; models: readonly DiscoveredModel[] }
  | { status: "failed"; message: string };

export function customProviderEndpoint(draft: CustomProviderDraft): CustomProviderEndpoint {
  const value = customProviderValue(draft);
  return { baseUrl: value.baseUrl, apiKey: value.apiKey, headers: value.headers };
}
