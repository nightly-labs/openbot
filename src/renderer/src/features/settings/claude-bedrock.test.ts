import type { ProviderEnvironmentVariable } from "@openbot/contracts/ipc";
import {
  type BedrockDraft,
  type BedrockField,
  bedrockDraft,
  bedrockMissingFields,
  bedrockVariables,
} from "@openbot/ui/features/settings/claude-bedrock";
import { describe, expect, it } from "vitest";

const plain = (name: string, value: string): ProviderEnvironmentVariable => ({
  name,
  value,
  sensitive: false,
  stored: false,
});
const secret = (name: string): ProviderEnvironmentVariable => ({ name, value: "", sensitive: true, stored: true });

function withFields(draft: BedrockDraft, values: ReadonlyArray<readonly [BedrockField, string]>): BedrockDraft {
  const fields = { ...draft.fields };
  for (const [field, value] of values) fields[field] = { value, stored: false };
  return { ...draft, fields };
}

describe("Claude Bedrock settings", () => {
  it("reads an empty environment as Bedrock off with an API key", () => {
    const draft = bedrockDraft([]);
    expect(draft.enabled).toBe(false);
    expect(draft.auth).toBe("apiKey");
    expect(bedrockMissingFields(draft)).toEqual([]);
  });

  it("reads saved Bedrock variables and keeps secrets hidden", () => {
    const draft = bedrockDraft([
      plain("CLAUDE_CODE_USE_BEDROCK", "1"),
      plain("AWS_REGION", "us-west-2"),
      secret("AWS_ACCESS_KEY_ID"),
      secret("AWS_SECRET_ACCESS_KEY"),
    ]);
    expect(draft.enabled).toBe(true);
    expect(draft.auth).toBe("accessKeys");
    expect(draft.fields.region).toEqual({ value: "us-west-2", stored: false });
    expect(draft.fields.secretAccessKey).toEqual({ value: "", stored: true });
    expect(bedrockMissingFields(draft)).toEqual([]);
  });

  it("names the required fields that are empty", () => {
    const draft = { ...bedrockDraft([]), enabled: true };
    expect(bedrockMissingFields(draft)).toEqual(["region", "apiKey"]);
    expect(bedrockMissingFields({ ...draft, auth: "accessKeys" })).toEqual([
      "region",
      "accessKeyId",
      "secretAccessKey",
    ]);
    expect(bedrockMissingFields({ ...draft, auth: "profile" })).toEqual(["region", "profile"]);
  });

  it("writes the Bedrock variables and keeps other variables", () => {
    const current = [plain("HTTPS_PROXY", "http://proxy:8080"), secret("MY_TOKEN"), plain("AWS_PROFILE", "old")];
    const draft = withFields({ ...bedrockDraft(current), enabled: true, auth: "apiKey" }, [
      ["region", " eu-central-1 "],
      ["apiKey", "bedrock-key"],
      ["sonnetModel", "eu.anthropic.claude-sonnet"],
    ]);
    expect(bedrockVariables(current, draft)).toEqual([
      { name: "HTTPS_PROXY", value: "http://proxy:8080", sensitive: false },
      { name: "MY_TOKEN", value: null, sensitive: true },
      { name: "CLAUDE_CODE_USE_BEDROCK", value: "1", sensitive: false },
      { name: "AWS_REGION", value: "eu-central-1", sensitive: false },
      { name: "AWS_BEARER_TOKEN_BEDROCK", value: "bedrock-key", sensitive: true },
      { name: "ANTHROPIC_DEFAULT_SONNET_MODEL", value: "eu.anthropic.claude-sonnet", sensitive: false },
    ]);
  });

  it("keeps a stored secret when its field stays empty", () => {
    const current = [
      plain("CLAUDE_CODE_USE_BEDROCK", "1"),
      plain("AWS_REGION", "us-east-1"),
      secret("AWS_BEARER_TOKEN_BEDROCK"),
    ];
    expect(bedrockVariables(current, bedrockDraft(current))).toEqual([
      { name: "CLAUDE_CODE_USE_BEDROCK", value: "1", sensitive: false },
      { name: "AWS_REGION", value: "us-east-1", sensitive: false },
      { name: "AWS_BEARER_TOKEN_BEDROCK", value: null, sensitive: true },
    ]);
  });

  it("removes all Bedrock variables when Bedrock is off", () => {
    const current = [
      plain("CLAUDE_CODE_USE_BEDROCK", "1"),
      plain("AWS_REGION", "us-east-1"),
      secret("AWS_BEARER_TOKEN_BEDROCK"),
      plain("OTHER", "x"),
    ];
    expect(bedrockVariables(current, { ...bedrockDraft(current), enabled: false })).toEqual([
      { name: "OTHER", value: "x", sensitive: false },
    ]);
  });

  it("drops the variables of the other sign-in methods", () => {
    const current = [
      plain("CLAUDE_CODE_USE_BEDROCK", "1"),
      plain("AWS_REGION", "us-east-1"),
      secret("AWS_BEARER_TOKEN_BEDROCK"),
    ];
    const draft = withFields({ ...bedrockDraft(current), auth: "profile" }, [["profile", "work"]]);
    expect(bedrockVariables(current, draft).map((variable) => variable.name)).toEqual([
      "CLAUDE_CODE_USE_BEDROCK",
      "AWS_REGION",
      "AWS_PROFILE",
    ]);
  });
});
