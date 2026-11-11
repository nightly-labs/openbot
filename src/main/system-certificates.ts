import { X509Certificate } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { Effect, Schema } from "effect";

// Node trusts only its bundled root list, so `fetch` and `ws` in the main process reject a root
// that the operating system trusts and Chromium accepts. A company network that inspects TLS, such
// as Fortinet or Zscaler, re-signs every connection with such a root. Sign-in and team calls then
// fail although the same address opens in a browser. Adding the system roots gives the main process
// the trust that Chromium already has; it does not turn off verification. The setting applies to
// this process only: agent CLIs get the same roots through `agentCertificateEnvironment`.
export function trustSystemCertificates(): void {
  const system = getCACertificates("system");
  if (system.length === 0) return;
  setDefaultCACertificates([...new Set([...getCACertificates("default"), ...system])]);
}

/** The file in the user data folder that holds the roots for agent CLIs. */
export const AGENT_CERTIFICATES_FILE = "agent-certificates.pem";

// A bundle that one of these names is the user's choice, so OpenBot then adds nothing. `httpx` reads
// `SSL_CERT_FILE` before `SSL_CERT_DIR`, so a file from OpenBot would hide the user's folder.
const USER_CERTIFICATE_VARIABLES = ["SSL_CERT_FILE", "SSL_CERT_DIR"] as const;

class AgentCertificatesFailed extends Schema.TaggedError<AgentCertificatesFailed>()("AgentCertificatesFailed", {
  cause: Schema.Defect(),
}) {}

/**
 * `SSL_CERT_FILE` for each provider process, pointing at the roots that this process trusts.
 *
 * Python agent CLIs read `certifi` only: Kimi CLI connects to an MCP server through `httpx`, so a
 * server behind a TLS-inspecting network passed OpenBot's test and failed each call of the agent
 * with `CERTIFICATE_VERIFY_FAILED` (#6616). `httpx` and OpenSSL read the bundle in `SSL_CERT_FILE`
 * in place of their own list, so the file holds the bundled roots as well as the system roots: a
 * program that reads it loses no root. Empty when the system adds no root to the bundled list.
 */
export const agentCertificateEnvironment = Effect.fn("SystemCertificates.agentEnvironment")(function* (
  file: string,
  inherited: NodeJS.ProcessEnv = process.env,
) {
  if (USER_CERTIFICATE_VARIABLES.some((name) => inherited[name])) return {};
  const roots = yield* Effect.try({
    try: () => {
      const bundled = new Set(getCACertificates("bundled").map(fingerprint));
      const system = getCACertificates("system");
      if (system.every((pem) => bundled.has(fingerprint(pem)))) return null;
      const unique = new Map<string, string>();
      for (const pem of [...getCACertificates("default"), ...system]) unique.set(fingerprint(pem), pem.trim());
      return `${[...unique.values()].join("\n")}\n`;
    },
    catch: (cause) => new AgentCertificatesFailed({ cause }),
  });
  if (roots === null) return {};
  // Rewritten only when the roots change. An agent process from an earlier run can still read the
  // file, so the new roots replace it whole: a reader never sees half of them.
  const current = yield* Effect.promise(() => readFile(file, "utf8").catch(() => null));
  if (current !== roots)
    yield* Effect.tryPromise({
      try: async () => {
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, roots);
        await rename(temporary, file).catch(async (error: unknown) => {
          await rm(temporary, { force: true });
          throw error;
        });
      },
      catch: (cause) => new AgentCertificatesFailed({ cause }),
    });
  return { SSL_CERT_FILE: file };
});

const fingerprint = (pem: string) => new X509Certificate(pem).fingerprint256;
