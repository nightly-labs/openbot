// Recorded provider transcripts are committed, so no prompt, answer, path, account detail or token
// may survive the redaction, in any field, also in a field that a later CLI version adds.
import { describe, expect, it } from "vitest";
import { assertRedacted, createTranscriptRedactor, REDACTED } from "./transcript-redaction";

const HOME = "/Users/alex-example";
const EMAIL = "alex@example.com";
const KNOWN = [HOME, "alex-example", EMAIL];

function redactAll(messages: readonly unknown[]): unknown[] {
  const redactor = createTranscriptRedactor(KNOWN);
  return messages.map((message) => redactor.redact(message));
}

describe("createTranscriptRedactor", () => {
  it("removes the prompt, the answer, paths and file contents in every field", () => {
    const [prompt, update] = redactAll([
      {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId: "ses_8f2a91", cwd: `${HOME}/work`, prompt: [{ type: "text", text: "Fix my bug" }] },
      },
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "ses_8f2a91",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call_1",
            title: "Read secrets.txt",
            rawInput: { path: `${HOME}/work/secrets.txt`, contents: "password=hunter22" },
          },
        },
      },
    ]);
    const text = JSON.stringify([prompt, update]);
    for (const leaked of ["Fix my bug", HOME, "secrets.txt", "hunter22", "ses_8f2a91", "call_1"]) {
      expect(text).not.toContain(leaked);
    }
    expect(prompt).toEqual({
      jsonrpc: "2.0",
      id: 3,
      method: "session/prompt",
      params: { sessionId: "sessionId-1", cwd: REDACTED, prompt: [{ type: "text", text: REDACTED }] },
    });
  });

  it("removes tokens and the account email, also from a field it keeps", () => {
    const [answer] = redactAll([
      {
        id: 1,
        result: {
          account: { email: EMAIL, type: "chatgpt" },
          headers: { Authorization: "Bearer abcdef1234567890" },
          provider: "sk-ant-abcdefgh12345678",
          status: `signed in as ${EMAIL}`,
        },
      },
    ]);
    const text = JSON.stringify(answer);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("abcdef1234567890");
    expect(text).not.toContain("sk-ant-");
    expect(answer).toEqual({
      id: 1,
      result: {
        account: { email: REDACTED, type: "chatgpt" },
        headers: { Authorization: REDACTED },
        provider: REDACTED,
        status: REDACTED,
      },
    });
  });

  it("keeps the protocol fields and public model names that a replay needs", () => {
    const [answer] = redactAll([
      {
        jsonrpc: "2.0",
        id: 2,
        result: {
          sessionId: "ses_8f2a91",
          models: { currentModelId: "opencode/big-pickle", availableModels: [{ modelId: "opencode/big-pickle" }] },
          configOptions: [{ id: "model", category: "model", currentValue: "opencode/big-pickle" }],
          stopReason: "end_turn",
          usage: { inputTokens: 1200, cached: false },
        },
      },
    ]);
    expect(answer).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        sessionId: "sessionId-1",
        models: { currentModelId: "opencode/big-pickle", availableModels: [{ modelId: "opencode/big-pickle" }] },
        configOptions: [{ id: "model", category: "model", currentValue: "opencode/big-pickle" }],
        stopReason: "end_turn",
        usage: { inputTokens: 1200, cached: false },
      },
    });
  });

  it("keeps the choices of a session config option, and redacts the same fields elsewhere", () => {
    const [answer] = redactAll([
      {
        id: 4,
        result: {
          configOptions: [
            {
              id: "model",
              name: "Model of alex",
              options: [
                { value: "opencode/big-pickle", name: "Big Pickle" },
                { name: "Zen", options: [{ value: "opencode/beam-free", name: "Beam" }] },
                { value: `${HOME}/model.gguf`, name: "Local" },
              ],
            },
          ],
          form: { name: "Fix my bug", value: "hunter22", options: [{ value: "hunter22" }] },
        },
      },
    ]);
    expect(answer).toEqual({
      id: 4,
      result: {
        configOptions: [
          {
            id: "model",
            name: REDACTED,
            options: [
              { value: "opencode/big-pickle", name: "Big Pickle" },
              { name: "Zen", options: [{ value: "opencode/beam-free", name: "Beam" }] },
              { value: REDACTED, name: "Local" },
            ],
          },
        ],
        form: { name: REDACTED, value: REDACTED, options: [{ value: REDACTED }] },
      },
    });
  });

  it("gives one id the same pseudonym in each message, and two ids different ones", () => {
    const [request, answer, other] = redactAll([
      { id: "req-A1", method: "session/load", params: { sessionId: "ses_one1" } },
      { id: "req-A1", result: { sessionId: "ses_one1" } },
      { id: "req-B2", method: "session/load", params: { sessionId: "ses_two2" } },
    ]);
    expect(request).toEqual({ id: "id-1", method: "session/load", params: { sessionId: "sessionId-2" } });
    expect(answer).toEqual({ id: "id-1", result: { sessionId: "sessionId-2" } });
    expect(other).toEqual({ id: "id-3", method: "session/load", params: { sessionId: "sessionId-4" } });
  });

  it("replaces keys that are data, such as paths and server names with a known value", () => {
    const [message] = redactAll([
      { result: { roots: { [`${HOME}/work`]: true, "my server": 1, alex_example_tools: 2, mcpServers: 3 } } },
    ]);
    const text = JSON.stringify(message);
    expect(text).not.toContain(HOME);
    expect(text).not.toContain("my server");
    expect(message).toEqual({ result: { roots: { "key-1": true, "key-2": 1, alex_example_tools: 2, mcpServers: 3 } } });
  });

  it("redacts an object under a choice field, also inside the choices of a config option", () => {
    const [answer] = redactAll([
      {
        result: {
          configOptions: [
            { options: [{ value: { label: "Fix my bug", path: `${HOME}/x` }, name: { text: "hunter22" } }] },
          ],
        },
      },
    ]);
    expect(answer).toEqual({
      result: {
        configOptions: [{ options: [{ value: { label: REDACTED, path: REDACTED }, name: { text: REDACTED } }] }],
      },
    });
  });

  it("replaces keys that hold a token or a long number", () => {
    const [message] = redactAll([
      {
        result: {
          "4f9c2a7b1e8d3f6a0b5c9e2d7a1f4b8c3e6d9a0f": true,
          account_48213377: 1,
          sk_live_abcdefgh12345678: 2,
          inputTokens: 3,
        },
      },
    ]);
    const text = JSON.stringify(message);
    for (const leaked of ["4f9c2a7b", "48213377", "sk_live_"]) expect(text).not.toContain(leaked);
    expect(message).toEqual({ result: { "key-1": true, "key-2": 1, "key-3": 2, inputTokens: 3 } });
  });

  it("redacts the home folder of a short user name in a kept field", () => {
    const redactor = createTranscriptRedactor(["/Users/al", "al"]);
    expect(redactor.redact({ result: { provider: "/Users/al/models", status: "ok" } })).toEqual({
      result: { provider: REDACTED, status: "ok" },
    });
  });

  it("replaces a known value in a key that looks like a field name", () => {
    const redactor = createTranscriptRedactor(["alexexample"]);
    expect(redactor.redact({ result: { alexexample_server: true } })).toEqual({ result: { "key-1": true } });
  });
});

describe("assertRedacted", () => {
  it("passes a redacted line", () => {
    const line = JSON.stringify(redactAll([{ id: 1, method: "initialize", params: { cwd: HOME } }])[0]);
    expect(() => assertRedacted(line, KNOWN)).not.toThrow();
  });

  it("passes token counts, which the log redaction masks in a whole JSON line", () => {
    const line = JSON.stringify(redactAll([{ id: 2, result: { usage: { inputTokens: 1200, totalTokens: 1300 } } }])[0]);
    expect(() => assertRedacted(line, KNOWN)).not.toThrow();
  });

  it("stops a line with a known value of this computer, in any letter case", () => {
    expect(() => assertRedacted(`{"cwd":"${HOME.toUpperCase()}"}`, KNOWN)).toThrow();
  });

  it("stops a line with a token or an email", () => {
    expect(() => assertRedacted('{"key":"sk-ant-abcdefgh12345678"}', [])).toThrow();
    expect(() => assertRedacted('{"to":"someone@example.org"}', [])).toThrow();
  });
});
