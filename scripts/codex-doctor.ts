import { CodexAppServerClient } from "../src/backend/app-server-client";
import { resolveCodexCli } from "../src/backend/cli";
import { decodeAccountReadResult, decodeRecordResponse } from "../src/backend/protocol";

const strict = process.argv.includes("--strict");
let client: CodexAppServerClient | null = null;

try {
  const cli = await resolveCodexCli();
  client = new CodexAppServerClient(cli.executable, 10_000);
  client.start();
  await client.request(
    "initialize",
    {
      clientInfo: { name: "openbot_doctor", title: "OpenBot Doctor", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    },
    decodeRecordResponse,
  );
  client.notify("initialized");

  const account = await client.request("account/read", { refreshToken: false }, decodeAccountReadResult);
  const auth = account.account
    ? {
        type: account.account.type,
        planType: account.account.type === "chatgpt" ? (account.account.planType ?? null) : null,
      }
    : null;

  // Machine-readable: doctor result JSON consumed by tooling.
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: account.account?.type === "chatgpt",
        executable: cli.executable,
        cliVersion: cli.version,
        appServer: "ready",
        auth,
      },
      null,
      2,
    )}\n`,
  );

  if (strict && account.account?.type !== "chatgpt") process.exitCode = 1;
} catch (error) {
  // Machine-readable: doctor failure JSON consumed by tooling.
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
  );
  process.exitCode = 1;
} finally {
  if (client) await client.stop();
}
