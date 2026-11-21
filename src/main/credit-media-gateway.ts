import {
  CREDIT_MEDIA_REQUEST_PART,
  type CreditMediaJobRequest,
  parseCreditMediaBalance,
  parseCreditMediaCatalog,
  parseCreditMediaJob,
} from "@openbot/contracts/credit-media";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import {
  type CreditMediaGateway,
  CreditMediaGatewayFailed,
  type CreditMediaUpload,
} from "../backend/workflows/credit-media";
import type { CentralAuthOperationError } from "./central-auth-effects";
import type { CentralAuthManager } from "./central-auth-manager";

const JSON_TIMEOUT_MS = 30_000;
const SUBMIT_TIMEOUT_MS = 120_000;
const OUTPUT_TIMEOUT_MS = 300_000;

type CreditMediaAuth = Pick<
  CentralAuthManager,
  "hasSession" | "hostSiteCredential" | "requestAuthorized" | "downloadAuthorized" | "requestAsHost" | "downloadAsHost"
>;

export interface CreditMediaGatewayOptions {
  auth: CreditMediaAuth;
  hostId: () => string | null;
  serverWallet: boolean;
}

type Payer = { kind: "personal" } | { kind: "server"; hostId: string };

function invalidResponse(): never {
  throw new Error(sourceText("error.workflow.mediaFailed"));
}

function decodeWith<T>(parse: (value: unknown) => T | null) {
  return (value: unknown): T => parse(value) ?? invalidResponse();
}

function causeStatus(cause: unknown): number {
  if (typeof cause !== "object" || cause === null || !("status" in cause)) return 0;
  return typeof cause.status === "number" ? cause.status : 0;
}

function causeMessage(cause: unknown): string {
  if (causeStatus(cause) > 0 && cause instanceof Error && cause.message) return cause.message;
  return sourceText("error.workflow.mediaFailed");
}

function toGatewayFailed(error: CentralAuthOperationError) {
  return new CreditMediaGatewayFailed({ message: causeMessage(error.cause), status: causeStatus(error.cause) });
}

function jobPath(jobId: string) {
  return `/v1/media/jobs/${encodeURIComponent(jobId)}/`;
}

function submitBody(request: CreditMediaJobRequest, inputs: readonly CreditMediaUpload[]) {
  const form = new FormData();
  form.set(CREDIT_MEDIA_REQUEST_PART, JSON.stringify(request));
  for (const input of inputs)
    form.append(input.role, new Blob([Uint8Array.from(input.bytes)], { type: input.mimeType }), input.role);
  return form;
}

export function createCreditMediaGateway({
  auth,
  hostId,
  serverWallet,
}: CreditMediaGatewayOptions): CreditMediaGateway {
  const serverPayer = (): Payer | null => {
    const id = hostId();
    return id && auth.hostSiteCredential(id) ? { kind: "server", hostId: id } : null;
  };
  const payers = (): Payer[] => {
    const server = serverPayer();
    const personal: Payer[] = !serverWallet && auth.hasSession() ? [{ kind: "personal" }] : [];
    return server ? [server, ...personal] : personal;
  };
  const payer = (): Payer | null => payers()[0] ?? null;
  const noPayer = () => new CreditMediaGatewayFailed({ message: sourceText("error.auth.signInRequired"), status: 401 });

  const call = <T, R>(
    current: Payer | null,
    send: (payer: Payer) => Effect.Effect<T, CentralAuthOperationError, R>,
  ): Effect.Effect<T, CreditMediaGatewayFailed, R> =>
    current ? send(current).pipe(Effect.mapError(toGatewayFailed)) : Effect.fail(noPayer());

  const firstOwner = <T, R>(
    send: (payer: Payer) => Effect.Effect<T, CentralAuthOperationError, R>,
  ): Effect.Effect<T, CreditMediaGatewayFailed, R> => {
    const [current = null, ...others] = payers();
    return others.reduce(
      (attempt, other) =>
        attempt.pipe(
          Effect.catchIf(
            (failure) => failure.status === 404,
            () => call(other, send),
          ),
        ),
      call(current, send),
    );
  };

  const requestAs =
    <T>(path: string, init: RequestInit, decode: (value: unknown) => T, timeoutMs = JSON_TIMEOUT_MS) =>
    (current: Payer) =>
      current.kind === "server"
        ? auth.requestAsHost(current.hostId, path, init, decode, timeoutMs)
        : auth.requestAuthorized(path, init, decode, timeoutMs);

  const downloadAs = (path: string) => (current: Payer) =>
    current.kind === "server"
      ? auth.downloadAsHost(current.hostId, path, OUTPUT_TIMEOUT_MS)
      : auth.downloadAuthorized(path, OUTPUT_TIMEOUT_MS);

  const request = <T>(path: string, init: RequestInit, decode: (value: unknown) => T, timeoutMs = JSON_TIMEOUT_MS) =>
    call(payer(), requestAs(path, init, decode, timeoutMs));

  return {
    available: () => payer() !== null,
    catalog: () => request("/v1/media/models", { method: "GET" }, decodeWith(parseCreditMediaCatalog)),
    balance: () => request("/v1/media/balance", { method: "GET" }, decodeWith(parseCreditMediaBalance)),
    submit: (job, inputs) =>
      request(
        "/v1/media/jobs/",
        { method: "POST", body: submitBody(job, inputs) },
        decodeWith(parseCreditMediaJob),
        SUBMIT_TIMEOUT_MS,
      ),
    job: (jobId) => firstOwner(requestAs(jobPath(jobId), { method: "GET" }, decodeWith(parseCreditMediaJob))),
    output: (jobId, index) => firstOwner(downloadAs(`${jobPath(jobId)}outputs/${index}`)),
  };
}
