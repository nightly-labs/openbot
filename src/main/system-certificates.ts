import { X509Certificate } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { Effect, Schema } from "effect";

export function trustSystemCertificates(): void {
  const system = getCACertificates("system");
  if (system.length === 0) return;
  setDefaultCACertificates([...new Set([...getCACertificates("default"), ...system])]);
}

export const AGENT_CERTIFICATES_FILE = "agent-certificates.pem";

const USER_CERTIFICATE_VARIABLES = ["SSL_CERT_FILE", "SSL_CERT_DIR"] as const;

class AgentCertificatesFailed extends Schema.TaggedError<AgentCertificatesFailed>()("AgentCertificatesFailed", {
  cause: Schema.Defect(),
}) {}

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
