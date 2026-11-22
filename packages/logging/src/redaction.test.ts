import { describe, expect, it, vi } from "vitest";
import {
  createOpenBotLogger,
  type LogValue,
  redactPostText,
  redactSecrets,
  redactText,
  redactValue,
  registerPublicValues,
  registerSecretValue,
  resolveLogLevel,
  toLogValue,
} from "./index";

function run64(length: number): string {
  return "Qw-_9z".repeat(length).slice(0, length);
}

describe("redactText", () => {
  it("redacts bearer tokens while keeping surrounding text", () => {
    expect(redactText("call with Bearer abcdef123456 and continue")).toBe("call with [redacted] and continue");
  });

  it("redacts provider secret prefixes", () => {
    expect(redactText("key sk-ant-abcdefgh1234 leaked")).toBe("key [redacted] leaked");
    expect(redactText("key xai-abcdefgh1234 leaked")).toBe("key [redacted] leaked");
    expect(redactText("key sk_0123456789abcdef0123 leaked")).toBe("key [redacted] leaked");
    expect(redactText("token xoxb-1234-5678-abcdefgh leaked")).toBe("token [redacted] leaked");
    expect(redactText("token xapp-1-A0123-4567-abcdef leaked")).toBe("token [redacted] leaked");
  });

  it("redacts more vendor key shapes", () => {
    const run = (length: number) => "Ab1".repeat(length).slice(0, length);
    for (const key of [
      `AIza${run(35)}`,
      `glpat-${run(20)}`,
      `npm_${run(36)}`,
      `hf_${run(34)}`,
      `gsk_${run(52)}`,
      `ASIA${"A1".repeat(8)}`,
      `rk_live_${run(24)}`,
      `rk_test_${run(24)}`,
      `whsec_${run(32)}`,
      `whsec_${run(10)}+${run(10)}/${run(10)}=`,
    ]) {
      expect(redactText(`key ${key} leaked`)).toBe("key [redacted] leaked");
    }
  });

  it("redacts a JSON Web Token", () => {
    const token = `eyJ${run64(20)}.eyJ${run64(40)}.${run64(43)}`;
    expect(redactText(`session ${token} expired`)).toBe("session [redacted] expired");
  });

  it("redacts a PEM private key with its body", () => {
    const body = `${"MIIEvQ".repeat(10)}\n${"QUFBQQ".repeat(10)}`;
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`;
    expect(redactText(`loaded ${pem} from disk`)).toBe("loaded [redacted] from disk");
    expect(redactText(`args ${JSON.stringify(pem).slice(1, -1)} end`)).toBe("args [redacted] end");
    expect(redactText(`partial -----BEGIN PRIVATE KEY-----\n${body}`)).toBe("partial [redacted]");
  });

  it("redacts every cookie in a cookie header", () => {
    const redacted = redactText("Cookie: session=first-value-1; csrf=second-value-2; theme=dark");
    expect(redacted).toBe("Cookie: [redacted]");
    expect(redactText("curl -H 'Cookie: a=one-value; b=two-value' https://example.com")).toBe(
      "curl -H 'Cookie: [redacted]' https://example.com",
    );
    expect(redactText('Cookie: a=one-value; b="quoted-secret"; c=three')).toBe("Cookie: [redacted]");
    expect(redactText('{"cookie":"a=b; s=\\"escaped-secret\\"","url":"/x"}')).not.toContain("escaped-secret");
  });

  it("bounds the work of repeated cookie and query prefixes", () => {
    const started = performance.now();
    redactText("cookie:".repeat(20_000));
    redactText("?key=".repeat(20_000));
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("redacts credential query values in a URL", () => {
    expect(redactText("GET https://example.com/cb?code=oauthcode123&state=abc ok")).toBe(
      "GET https://example.com/cb?code=[redacted]&state=abc ok",
    );
    expect(redactText("https://example.com/v1?alt=json&key=abcdefgh12345678")).toBe(
      "https://example.com/v1?alt=json&key=[redacted]",
    );
    expect(redactText("https://example.com/login?ticket=ST-12345-abcdefgh#top")).toBe(
      "https://example.com/login?ticket=[redacted]#top",
    );
    expect(redactText("https://example.com/file?sig=abcdefgh12345678")).toBe("https://example.com/file?sig=[redacted]");
    expect(redactText("https://example.com/cb?api_key=abcdef12&code=oauthcode123")).not.toContain("oauthcode123");
  });

  it("keeps text that looks like the new secret shapes", () => {
    for (const text of [
      "npm_config_user_agent is set",
      "hf_hub_download failed",
      "ASIA-PACIFIC region is slow",
      "paste the -----BEGIN PRIVATE KEY----- block here",
      "https://example.com/docs?key=short&code=200",
      "https://example.com/docs?key=YOUR_API_KEY",
      "monkey=banana and keyboard=us",
      "eyJhbGciOiJIUzI1NiJ9 alone",
    ]) {
      expect(redactText(text)).toBe(text);
    }
  });

  it("leaves a line with the new secret shapes unchanged when it passes through twice", () => {
    const line =
      "Cookie: a=one-value; b=two-value\nGET /cb?code=oauthcode123&key=abcdefgh12345678 " +
      `eyJ${run64(20)}.eyJ${run64(40)}.${run64(43)}`;
    const once = redactText(line);
    expect(redactText(once)).toBe(once);
  });

  it("leaves an ordinary word that starts like a provider prefix alone", () => {
    expect(redactText("marketplace agent risk-register failed to install")).toBe(
      "marketplace agent risk-register failed to install",
    );
    expect(redactText("task_scheduler_started for desk_reference_index")).toBe(
      "task_scheduler_started for desk_reference_index",
    );
  });

  it("drops a payload too malformed to reparse", () => {
    expect(redactText('{"key":"pk_live_abcdefgh1234","truncated')).toBe("[redacted-unscanned]");
  });

  it("drops a balanced payload that does not parse, with everything under it", () => {
    expect(redactText('ERROR {"headers":{"X-Tenant":"tenant-secret"},}')).toBe("ERROR [redacted-unscanned]");
  });

  it("keeps a line whose braces hold no payload", () => {
    expect(redactText("note {not json} and more")).toBe("note {not json} and more");
  });

  it("keeps template placeholders and links that are not records", () => {
    expect(redactText("Dear {{name}}, see {{ a.b }} and [[Page]]")).toBe("Dear {{name}}, see {{ a.b }} and [[Page]]");
    expect(redactText("m = [[a, b], [c, d]]")).toBe("m = [[a, b], [c, d]]");
    expect(redactText("a chunk that ends {{na")).toBe("a chunk that ends {{na");
    const template = Array.from({ length: 16 }, (_, index) => `{{p${index}}}`).join(" ");
    expect(redactText(template)).toBe(template);
    expect(redactText('ERROR [{"headers":{"X-Tenant":"tenant-secret"}},]')).toBe("ERROR [redacted-unscanned]");
  });

  it("redacts a serialized payload no matter how long it is", () => {
    const padding = "x".repeat(200_000);
    expect(redactText(JSON.stringify({ key: "pk_live_abcdefgh1234", padding }))).toBe(
      JSON.stringify({ key: "[redacted]", padding }),
    );
  });

  it("redacts credential assignments and emails", () => {
    expect(redactText("password=hunter2 ok")).toBe("password=[redacted] ok");
    expect(redactText("OPENCODE_API_KEY=abc123def")).not.toContain("abc123def");
    expect(redactText("contact jan@example.com please")).toBe("contact [redacted-email] please");
  });

  it("keeps emails and redacts secrets for the agent", () => {
    expect(redactSecrets("account jan@example.com, password=hunter2")).toBe(
      "account jan@example.com, password=[redacted]",
    );
    expect(redactSecrets('note {"email":"jan@example.com","apiKey":"pk_live_9f2b3c4d5e"}')).toBe(
      'note {"email":"jan@example.com","apiKey":"[redacted]"}',
    );
    expect(redactSecrets('{"jan@example.com":"Bearer abcdef123456"}')).toBe('{"jan@example.com":"[redacted]"}');
  });

  it("masks only key formats in a chat app post", () => {
    expect(redactPostText("Write to jan@example.com, password=hunter2, key sk-ant-api03-abcdefgh")).toBe(
      "Write to jan@example.com, password=hunter2, key [redacted]",
    );
    expect(redactPostText("postgres://admin:s3cretpw@db.example.com/app")).toBe(
      "postgres://admin:[redacted]@db.example.com/app",
    );
    expect(redactText("https://user:s3cretpw@db.example.com/x")).toBe("https://user:[redacted]@db.example.com/x");
    expect(redactSecrets("redis://:s3cretpw@cache:6379")).toBe("redis://:[redacted]@cache:6379");
    const code = `${"{} ".repeat(16)}{"headers":{"X-Tenant":"tenant"}}`;
    expect(redactPostText(code)).toBe(code);
    expect(redactPostText("Authorization: Bearer abcdef123456")).toBe("Authorization: [redacted]");
  });

  it("redacts secrets inside a payload that arrives as one string", () => {
    expect(redactText('{"apiKey":"pk_live_9f2b3c4d5e"}')).not.toContain("pk_live_9f2b3c4d5e");
    expect(redactText('{"machineToken":"mt_abc123def456"}')).not.toContain("mt_abc123def456");
    expect(redactText('body={"password":"hunter2"}')).not.toContain("hunter2");
    expect(redactText('{"key":"pk_live_9f2b3c4d5e"}')).not.toContain("pk_live_9f2b3c4d5e");
  });

  it("redacts a quoted credential whole instead of stopping at the first space", () => {
    expect(redactText('password: "my secret pass"')).toBe('password: "[redacted]"');
  });

  it("leaves prose that mentions a secret without assigning one intact", () => {
    expect(redactText("SKILLS_ADMIN_TOKEN is missing")).toBe("SKILLS_ADMIN_TOKEN is missing");
    expect(redactText("Encrypted EMAIL_SMTP_PASSWORD for dev and production.")).toBe(
      "Encrypted EMAIL_SMTP_PASSWORD for dev and production.",
    );
  });

  it("redacts scheme-prefixed authorization values and cookies", () => {
    expect(redactText("Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l")).toBe("Authorization: [redacted]");
    expect(redactText("set-cookie: session=9f2b3c4d5e6f")).not.toContain("9f2b3c4d5e6f");
  });

  it("redacts the token after any authorization scheme", () => {
    expect(redactText(`Authorization: Bot ${run64(24)}.${run64(6)}.${run64(27)} sent`)).toBe(
      "Authorization: [redacted] sent",
    );
    expect(redactText("authorization: ApiKey abcdef1234567890")).toBe("authorization: [redacted]");
    expect(redactText("Proxy-Authorization: Negotiate YIIabcdef1234567890")).toBe("Proxy-Authorization: [redacted]");
  });

  it("redacts Google OAuth tokens, Telegram bot tokens and webhook addresses", () => {
    expect(redactText(`token ya29.${run64(40)} expired`)).toBe("token [redacted] expired");
    expect(redactText(`client GOCSPX-${run64(28)} refused`)).toBe("client [redacted] refused");
    const telegram = `123456789:AA${run64(33)}`;
    expect(redactText(`GET https://api.telegram.org/bot${telegram}/getMe failed`)).toBe(
      "GET https://api.telegram.org/[redacted]/getMe failed",
    );
    expect(redactText(`token ${telegram} refused`)).toBe("token [redacted] refused");
    const slack = redactText(`post https://hooks.slack.com/services/T01ABCDEF/B01ABCDEF/${run64(24)} failed`);
    expect(slack).toBe("post https://hooks.slack.com/services/[redacted] failed");
    expect(redactText(slack)).toBe(slack);
    expect(redactText(`post https://discord.com/api/webhooks/123456789012345678/${run64(68)} failed`)).toBe(
      "post https://discord.com/api/webhooks/[redacted] failed",
    );
    expect(redactText("see https://api.slack.com/messaging/webhooks and 12:30:45")).toBe(
      "see https://api.slack.com/messaging/webhooks and 12:30:45",
    );
  });

  it("leaves scheme words used as ordinary prose alone", () => {
    expect(redactText("Token validation failed")).toBe("Token validation failed");
    expect(redactText("Basic authentication unavailable")).toBe("Basic authentication unavailable");
  });

  it("leaves an already redacted line unchanged when it passes through twice", () => {
    const once = redactText('{"password":"hunter2"}');
    expect(redactText(once)).toBe(once);
    expect(redactText(redactText("password=hunter2"))).toBe("password=[redacted]");
  });

  it("redacts the key inside a serialized OpenCode config and keeps the base URL", () => {
    const config = JSON.stringify({
      provider: {
        "studio-local": {
          options: { baseURL: "http://127.0.0.1:11434/v1", apiKey: "abcdef123456" },
        },
      },
    });
    const redacted = redactText(config);
    expect(redacted).not.toContain("abcdef123456");
    expect(redacted).toContain("http://127.0.0.1:11434/v1");
  });

  it("leaves identifiers such as agent UUIDs untouched", () => {
    const uuid = "agent-3fa85f64-5717-4562-b3fc-2c963f66afa6";
    expect(redactText(`loaded ${uuid}`)).toBe(`loaded ${uuid}`);
  });
  it("redacts a payload embedded in a longer line", () => {
    expect(redactText('ERROR request failed: {"headers":{"X-Tenant":"tenant-secret"}}')).toBe(
      'ERROR request failed: {"headers":{"X-Tenant":"[redacted]"}}',
    );
    expect(redactText('sent {"apiKey":"abcdef123456"} and got {"headers":{"A":"b"}} back')).toBe(
      'sent {"apiKey":"[redacted]"} and got {"headers":{"A":"[redacted]"}} back',
    );
  });

  it("leaves prose with an unbalanced brace alone", () => {
    expect(redactText("two headers were rejected { and the run never closes")).toBe(
      "two headers were rejected { and the run never closes",
    );
  });

  it("drops a payload that the line cuts off", () => {
    expect(redactText('ERROR {"headers":{"X-Tenant":"tenant-secret"')).toBe("ERROR [redacted-unscanned]");
    expect(redactText('{"apiKey":"abcdef123456')).toBe("[redacted-unscanned]");
  });

  it("drops the rest of a line whose payloads pass the scan bound", () => {
    const redacted = redactText(`${"{} ".repeat(16)}{"headers":{"X-Tenant":"tenant-secret"}}`);
    expect(redacted).not.toContain("tenant-secret");
    expect(redacted).toContain("[redacted-unscanned]");
  });

  it("keeps the rest of the agent's own text past the scan bound", () => {
    const code = Array.from({ length: 40 }, (_, index) => `v${index} = close[${index}] > open[${index}]`).join("\n");
    expect(redactSecrets(code)).toBe(code);
    expect(redactSecrets(`${code}\ntoken = Bearer abcdef123456`)).toBe(`${code}\ntoken = [redacted]`);
    expect(redactSecrets(`${code}\n{"apiKey":"abcdef123456"}`)).toBe(`${code}\n{"apiKey":"[redacted]"}`);
  });

  it("bounds the work a line of open braces can cause", () => {
    const braces = "{".repeat(65_536);
    const started = performance.now();
    expect(redactText(braces)).toBe(braces);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("keeps the text around an embedded payload", () => {
    expect(redactText("read [1, 2, 3] items")).toBe("read [1, 2, 3] items");
  });

  it("keeps a payload that no rule changes as it was written", () => {
    const example = 'Use:\n```json\n{"channelId": 1234567890123456789, "ids": [9876543210987654321]}\n```';
    expect(redactText(example)).toBe(example);
    expect(redactText('{"channelId": 1234567890123456789}')).toBe('{"channelId": 1234567890123456789}');
    const result = JSON.stringify({ instructions: example });
    expect(JSON.parse(redactText(result)).instructions).toBe(example);
  });

  it("writes a payload again when it has a secret or a key written twice", () => {
    expect(redactText('note {"apiKey": "pk_live_9f2b3c4d5e", "n": 1}')).toBe('note {"apiKey":"[redacted]","n":1}');
    expect(redactText('ERROR {"headers": {"X-Tenant": "tenant-secret"}, "headers": {}}')).toBe('ERROR {"headers":{}}');
    expect(redactText('{"headers": {"X-Tenant": "tenant-secret"}, "headers": {}}')).toBe('{"headers":{}}');
  });

  it("cuts a payload nested past the depth bound", () => {
    const depth = 100_000;
    const payload = `${'{"a":'.repeat(depth)}{"headers":{"X":"tenant-secret"}}${"}".repeat(depth)}`;
    for (const line of [payload, `ERR ${payload}`]) {
      const redacted = redactText(line);
      expect(redacted).not.toContain("tenant-secret");
      expect(redacted).toContain("[too deep]");
    }
  });
});

describe("registerSecretValue", () => {
  it("masks a registered value in every form a log line can carry it", () => {
    const secret = 'x7Kq"9Lm/2Pz';
    registerSecretValue(secret);

    expect(redactText(`provider said ${secret} was refused`)).toBe("provider said [redacted] was refused");
    expect(redactText(`body ${JSON.stringify({ note: secret })}`)).toBe('body {"note":"[redacted]"}');
    expect(redactText(`GET /v1?k=${encodeURIComponent(secret)} failed`)).toBe("GET /v1?k=[redacted] failed");
    expect(redactValue({ detail: [`retry ${secret}`] })).toEqual({ detail: ["retry [redacted]"] });
  });

  it("does not register a value too short to be a secret", () => {
    registerSecretValue("8080");

    expect(redactText("listening on 8080")).toBe("listening on 8080");
  });

  it("keeps label rules working when a registered value is a label", () => {
    registerSecretValue("password");

    expect(redactText("password=opaque-value")).not.toContain("opaque-value");
    expect(redactText('{"password":"opaque-value"}')).not.toContain("opaque-value");
    registerSecretValue("Authorization");
    expect(redactText("Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l")).not.toContain("YWxhZGRpbjpvcGVuc2VzYW1l");
  });

  it("masks a registered value whole when a label rule would cut it", () => {
    registerSecretValue("hunter22 suffix99");

    expect(redactText("password=hunter22 suffix99 rejected")).toMatch(/=\[redacted\] rejected$/u);
    registerSecretValue("monkey22 suffix99");
    expect(redactText("password=monkey22 suffix99 rejected")).toMatch(/=\[redacted\] rejected$/u);
  });

  it("masks a longer credential that starts with a registered value", () => {
    registerSecretValue("Bearer abc");

    expect(redactText("sent Bearer abcdefghijklmnop to the server")).toBe("sent [redacted] to the server");
  });

  it("masks a registered value that starts inside the token of another", () => {
    registerSecretValue("prefix88");
    registerSecretValue("Basic c2VjcmV0");

    expect(redactText("sent prefix88/Basic c2VjcmV0 twice")).toBe("sent [redacted] twice");
  });

  it("keeps the host of a web address, and masks its user part and path", () => {
    registerSecretValue("acmeshop", { allowShort: true });
    registerSecretValue("feedtoken42x");

    expect(redactText("see https://acmeshop.pl/offer?x=1 and https://shop.acmeshop.pl")).toBe(
      "see https://acmeshop.pl/offer?x=1 and https://shop.acmeshop.pl",
    );
    expect(redactText("https://example.com/feed/feedtoken42x")).toBe("https://example.com[redacted]");
    expect(redactText("https://user:acmeshop@db.example.com/x")).not.toContain("acmeshop");
    expect(redactText("myapp://acmeshop/callback")).not.toContain("acmeshop");
    expect(redactText("sign in with acmeshop")).toBe("sign in with [redacted]");
  });

  it("keeps a public model id that contains a short saved value, and masks the value elsewhere", () => {
    registerSecretValue("claude", { allowShort: true });
    registerPublicValues(["claude-opus-5-5", "claude-sonnet-5-5", "claude"]);

    const models = '{"defaultModel":"claude-opus-5-5","models":[{"id":"claude-sonnet-5-5","name":"Claude Opus 5.5"}]}';
    expect(redactText(models)).toBe(models);
    expect(redactText("Available models: claude-opus-5-5, claude-sonnet-5-5, …")).toBe(
      "Available models: claude-opus-5-5, claude-sonnet-5-5, …",
    );
    expect(redactText("The model is claude-opus-5-5.")).toBe("The model is claude-opus-5-5.");
    expect(redactText('{"provider":"claude"}')).not.toContain("claude");
    for (const text of [
      "claude-opus-5-6",
      "sshpass -pclaude ssh h",
      'out="typed:\\nclaude\\n"',
      "next=%2Flogin%3Fpw%3Dclaude%26x",
      "my password is claude.Then",
      "pw=claude-1",
      "pw: claude_",
      "https://user:claude@db.example.com/x",
    ]) {
      expect(redactText(text)).not.toContain("claude");
    }
  });

  it("masks a saved value that ends where a public id ends", () => {
    registerSecretValue("sonnet-5-5.", { allowShort: true });
    registerPublicValues(["claude-sonnet-5-5"]);

    expect(redactText("pw=claude-sonnet-5-5.")).not.toContain("sonnet-5-5");
  });

  it("masks a saved value in a chat app post only when it is a whole token", () => {
    registerSecretValue("acmeshop", { allowShort: true });

    expect(
      redactPostText(
        "Code: acmeshop. Write to biuro@acmeshop.pl, see https://acmeshop.pl/kontakt, acmeshopping, zażółćacmeshop",
      ),
    ).toBe(
      "Code: [redacted]. Write to biuro@acmeshop.pl, see https://acmeshop.pl/kontakt, acmeshopping, zażółćacmeshop",
    );
  });

  it("masks an internal token with no key format in a chat app post", () => {
    registerSecretValue("mt4f9a2c7e1b3d5f60");

    expect(redactPostText("Token: `mt4f9a2c7e1b3d5f60` and http://127.0.0.1:4100/mcp/mt4f9a2c7e1b3d5f60")).toBe(
      "Token: `[redacted]` and http://127.0.0.1:4100/mcp/[redacted]",
    );
    expect(redactPostText("https://x.example/cb?next=%2Fa%3Ftoken%3Dmt4f9a2c7e1b3d5f60%26b%3D1")).toBe(
      "https://x.example/cb?next=%2Fa%3Ftoken%3D[redacted]%26b%3D1",
    );
  });

  it("keeps a value that cannot be URL-encoded masked, without throwing", () => {
    const secret = "12345678\uD800";
    registerSecretValue(secret);

    expect(redactText(`key ${secret} rejected`)).toBe("key [redacted] rejected");
  });
});

describe("redactValue", () => {
  it("redacts secret-valued keys deep inside objects", () => {
    expect(redactValue({ nested: { machineToken: "abcdef123456", name: "alfred" } })).toEqual({
      nested: { machineToken: "[redacted]", name: "alfred" },
    });
  });

  it("redacts every value under a headers object, whatever the header is called", () => {
    expect(redactValue({ headers: { "X-Api-Token": "abcdef123456", "X-Tenant": "acme" } })).toEqual({
      headers: { "X-Api-Token": "[redacted]", "X-Tenant": "[redacted]" },
    });
    expect(redactValue({ headers: [{ name: "X-Api-Token", value: "abcdef123456" }] })).toEqual({
      headers: [{ name: "[redacted]", value: "[redacted]" }],
    });
  });

  it("redacts the value of a pair whose name labels a secret", () => {
    expect(
      redactValue({
        env: [
          { name: "OPENAI_API_KEY", value: "opaque-value-123" },
          { name: "LOG_LEVEL", value: "debug" },
        ],
      }),
    ).toEqual({
      env: [
        { name: "OPENAI_API_KEY", value: "[redacted]" },
        { name: "LOG_LEVEL", value: "debug" },
      ],
    });
    expect(redactText('env [{"name":"GITHUB_TOKEN","value":"opaque-value-123"}]')).not.toContain("opaque-value-123");
  });

  it("leaves a headers count and the word in prose alone", () => {
    expect(redactValue({ headers: 3, note: "two headers were rejected" })).toEqual({
      headers: 3,
      note: "two headers were rejected",
    });
  });
});

describe("toLogValue", () => {
  it("bounds a deeply nested value instead of overflowing the stack", () => {
    let deep: LogValue = "leaf";
    for (let index = 0; index < 50_000; index += 1) deep = [deep];
    expect(() => toLogValue(deep)).not.toThrow();
    expect(JSON.stringify(toLogValue(deep))).toContain("[too deep]");
  });

  it("breaks reference cycles instead of overflowing", () => {
    const loop: { name: string; self?: unknown } = { name: "chief" };
    loop.self = loop;
    expect(() => toLogValue(loop)).not.toThrow();
    expect(toLogValue(loop)).toEqual({ name: "chief", self: "[circular]" });
  });

  it("serializes bigints instead of throwing in JSON.stringify", () => {
    const lines: string[] = [];
    const logger = createOpenBotLogger("automation", (line) => lines.push(line));
    expect(() => logger.info("count", 10n)).not.toThrow();
    expect(lines[0]).toContain("10n");
  });
  it("keeps error details while redacting secrets when logged", () => {
    const lines: string[] = [];
    const logger = createOpenBotLogger("automation", (line) => lines.push(line));
    logger.error("provider failed", toLogValue(new Error("failed with Bearer abcdef123456")));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("provider failed");
    expect(lines[0]).toContain("Error");
    expect(lines[0]).not.toContain("abcdef123456");
  });

  it("redacts a secret carried by a key or an error name", () => {
    expect(JSON.stringify(toLogValue({ "jan@example.com": "present" }))).not.toContain("jan@example.com");
    const named = new Error("failed");
    named.name = "Bearer abcdef123456";
    expect(JSON.stringify(toLogValue(named))).not.toContain("abcdef123456");
    expect(String(toLogValue(Symbol("jan@example.com")))).not.toContain("jan@example.com");
  });

  it("survives a value whose own getters throw", () => {
    const hostile = {
      get detail() {
        throw new Error("boom");
      },
    };
    expect(() => toLogValue(hostile)).not.toThrow();
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("denied");
        },
      },
    );
    expect(toLogValue(proxy)).toBe("[unserializable]");
  });

  it("falls back to strings for values without a log shape", () => {
    expect(toLogValue(undefined)).toBe(undefined);
    expect(toLogValue(42)).toBe(42);
    expect(typeof toLogValue(Symbol("scope"))).toBe("string");
  });
});

describe("resolveLogLevel", () => {
  it("falls back to info for an unset or unknown value", () => {
    expect(resolveLogLevel(undefined)).toBe("info");
    expect(resolveLogLevel("verbose")).toBe("info");
    expect(resolveLogLevel("debug")).toBe("debug");
  });
});

describe("createOpenBotLogger", () => {
  it("prefixes lines and redacts secrets before they reach the sink", () => {
    const lines: string[] = [];
    const logger = createOpenBotLogger("automation", (line) => lines.push(line));
    logger.info("hello", { token: "abcdef123456" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[automation]");
    expect(lines[0]).toContain("hello");
    expect(lines[0]).not.toContain("abcdef123456");
  });

  it("drops calls below the configured level", () => {
    const lines: string[] = [];
    const logger = createOpenBotLogger("automation", (line) => lines.push(line), "warn");
    logger.debug("noisy");
    logger.info("routine");
    logger.warn("careful");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("careful");
  });

  it("keeps every level when asked for trace and none when silenced", () => {
    const traced: string[] = [];
    createOpenBotLogger("automation", (line) => traced.push(line), "trace").trace("deep");
    expect(traced).toHaveLength(1);
    const silenced: string[] = [];
    createOpenBotLogger("automation", (line) => silenced.push(line), "silent").error("boom");
    expect(silenced).toHaveLength(0);
  });

  it("routes warnings through the error sink when no sink is given", () => {
    const error = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    createOpenBotLogger("automation").warn("careful");
    expect(error).toHaveBeenCalledOnce();
  });
});
