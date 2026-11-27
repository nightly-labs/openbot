import type { ProviderEnvironmentVariable, ProviderEnvironmentVariableInput } from "@openbot/contracts/ipc";

export const BEDROCK_AUTH_METHODS = ["apiKey", "accessKeys", "profile"] as const;
export type BedrockAuthMethod = (typeof BEDROCK_AUTH_METHODS)[number];

export const BEDROCK_SWITCH = "CLAUDE_CODE_USE_BEDROCK";

export const BEDROCK_FIELDS = {
  region: { name: "AWS_REGION", sensitive: false },
  apiKey: { name: "AWS_BEARER_TOKEN_BEDROCK", sensitive: true },
  accessKeyId: { name: "AWS_ACCESS_KEY_ID", sensitive: true },
  secretAccessKey: { name: "AWS_SECRET_ACCESS_KEY", sensitive: true },
  sessionToken: { name: "AWS_SESSION_TOKEN", sensitive: true },
  profile: { name: "AWS_PROFILE", sensitive: false },
  opusModel: { name: "ANTHROPIC_DEFAULT_OPUS_MODEL", sensitive: false },
  sonnetModel: { name: "ANTHROPIC_DEFAULT_SONNET_MODEL", sensitive: false },
  haikuModel: { name: "ANTHROPIC_DEFAULT_HAIKU_MODEL", sensitive: false },
} as const satisfies Record<string, { name: string; sensitive: boolean }>;

export type BedrockField = keyof typeof BEDROCK_FIELDS;

const AUTH_FIELDS: Readonly<Record<BedrockAuthMethod, readonly BedrockField[]>> = {
  apiKey: ["apiKey"],
  accessKeys: ["accessKeyId", "secretAccessKey", "sessionToken"],
  profile: ["profile"],
};

const REQUIRED_AUTH_FIELDS: Readonly<Record<BedrockAuthMethod, readonly BedrockField[]>> = {
  apiKey: ["apiKey"],
  accessKeys: ["accessKeyId", "secretAccessKey"],
  profile: ["profile"],
};

const MODEL_FIELDS: readonly BedrockField[] = ["opusModel", "sonnetModel", "haikuModel"];

/** The variable names that the Bedrock form owns. The form keeps all other variables. */
export const BEDROCK_VARIABLE_NAMES: ReadonlySet<string> = new Set([
  BEDROCK_SWITCH,
  ...Object.values(BEDROCK_FIELDS).map((field) => field.name),
]);

export interface BedrockFieldValue {
  /** The typed value. An empty value of a stored secret keeps the stored secret. */
  value: string;
  /** True when a sensitive value is saved and the form does not show it. */
  stored: boolean;
}

export interface BedrockDraft {
  enabled: boolean;
  auth: BedrockAuthMethod;
  fields: Record<BedrockField, BedrockFieldValue>;
}

const EMPTY_FIELD: BedrockFieldValue = { value: "", stored: false };

function isOn(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/** Reads the Bedrock form from the saved Claude variables. */
export function bedrockDraft(variables: readonly ProviderEnvironmentVariable[]): BedrockDraft {
  const byName = new Map(variables.map((variable) => [variable.name, variable]));
  const read = (field: BedrockField): BedrockFieldValue => {
    const variable = byName.get(BEDROCK_FIELDS[field].name);
    if (!variable) return EMPTY_FIELD;
    return { value: variable.sensitive ? "" : variable.value, stored: variable.sensitive && variable.stored };
  };
  const fields: Record<BedrockField, BedrockFieldValue> = {
    region: read("region"),
    apiKey: read("apiKey"),
    accessKeyId: read("accessKeyId"),
    secretAccessKey: read("secretAccessKey"),
    sessionToken: read("sessionToken"),
    profile: read("profile"),
    opusModel: read("opusModel"),
    sonnetModel: read("sonnetModel"),
    haikuModel: read("haikuModel"),
  };
  const has = (field: BedrockField) => fields[field].stored || fields[field].value.trim() !== "";
  const auth: BedrockAuthMethod = has("apiKey")
    ? "apiKey"
    : has("accessKeyId") || has("secretAccessKey")
      ? "accessKeys"
      : has("profile")
        ? "profile"
        : "apiKey";
  return { enabled: isOn(byName.get(BEDROCK_SWITCH)?.value), auth, fields };
}

/** The required fields that the draft does not fill. An empty list means the draft can be saved. */
export function bedrockMissingFields(draft: BedrockDraft): BedrockField[] {
  if (!draft.enabled) return [];
  const required: BedrockField[] = ["region", ...REQUIRED_AUTH_FIELDS[draft.auth]];
  return required.filter((field) => !draft.fields[field].stored && draft.fields[field].value.trim() === "");
}

/**
 * Makes the full variable list to save. It keeps the variables that the form does not own,
 * and replaces the Bedrock variables with the values of the draft. When Bedrock is off,
 * it removes all Bedrock variables.
 */
export function bedrockVariables(
  current: readonly ProviderEnvironmentVariable[],
  draft: BedrockDraft,
): ProviderEnvironmentVariableInput[] {
  const kept: ProviderEnvironmentVariableInput[] = current
    .filter((variable) => !BEDROCK_VARIABLE_NAMES.has(variable.name))
    .map((variable) => ({
      name: variable.name,
      value: variable.sensitive && variable.stored ? null : variable.value,
      sensitive: variable.sensitive,
    }));
  if (!draft.enabled) return kept;
  const owned: ProviderEnvironmentVariableInput[] = [{ name: BEDROCK_SWITCH, value: "1", sensitive: false }];
  for (const key of ["region", ...AUTH_FIELDS[draft.auth], ...MODEL_FIELDS] as const) {
    const field = BEDROCK_FIELDS[key];
    const entry = draft.fields[key];
    const value = entry.value.trim();
    if (value !== "") owned.push({ name: field.name, value, sensitive: field.sensitive });
    else if (field.sensitive && entry.stored) owned.push({ name: field.name, value: null, sensitive: true });
  }
  return [...kept, ...owned];
}
