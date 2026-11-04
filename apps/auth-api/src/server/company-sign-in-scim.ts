// The SCIM 2.0 user endpoint of company sign-in (RFC 7643, RFC 7644), only as much as Entra ID, Okta
// and Google use for provisioning: find a user by `userName`, add one, and turn one off or on. A
// user is an OpenBot account at one of the connection's domains, and `userName` is its email.

import { type DynamicRecord, isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { ScimUser } from "./company-sign-in";
import { CompanySignInError } from "./company-sign-in";
import { JsonBodyError, readJsonObject } from "./json-body";
import { bearerToken, requestCompanySignIn } from "./request-auth";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const USER_NAME_FILTER = /^userName eq "([^"]{1,320})"$/iu;

function scimJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/scim+json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function scimError(status: number, detail: string, scimType?: string): Response {
  return scimJson(
    { schemas: [ERROR_SCHEMA], status: String(status), detail, ...(scimType ? { scimType } : {}) },
    status,
  );
}

export function scimErrorResponse(error: unknown): Response {
  if (error instanceof CompanySignInError) {
    return scimError(error.status, error.message, error.status === 400 ? "invalidValue" : undefined);
  }
  if (error instanceof JsonBodyError) return scimError(error.status, error.message, "invalidSyntax");
  // The type of the failure only. Its cause can hold provider data.
  console.error("SCIM request failed:", error instanceof Error ? error.name : typeof error);
  return scimError(500, "The request failed.");
}

function representation(user: ScimUser, requestUrl: string) {
  return {
    schemas: [USER_SCHEMA],
    id: user.id,
    ...(user.externalId ? { externalId: user.externalId } : {}),
    userName: user.email,
    active: user.active,
    emails: [{ value: user.email, primary: true }],
    ...(user.name ? { displayName: user.name } : {}),
    meta: { resourceType: "User", location: new URL(`/scim/v2/Users/${user.id}`, requestUrl).toString() },
  };
}

/** `active` in a SCIM body. Entra ID sends the strings "True" and "False". */
function readActive(value: unknown): boolean | null {
  if (isBoolean(value)) return value;
  if (isString(value) && /^(?:true|false)$/iu.test(value)) return value.toLowerCase() === "true";
  return null;
}

/** The new `active` of a PatchOp body, or undefined when the operations do not change it. */
function patchActive(body: DynamicRecord): boolean | undefined | null {
  if (!Array.isArray(body.schemas) || !body.schemas.includes(PATCH_SCHEMA) || !Array.isArray(body.Operations)) {
    return null;
  }
  let active: boolean | undefined;
  for (const operation of body.Operations) {
    if (!isDynamicRecord(operation) || !isString(operation.op)) return null;
    const op = operation.op.toLowerCase();
    if (op !== "replace" && op !== "add") continue;
    if (isString(operation.path)) {
      if (operation.path.toLowerCase() !== "active") continue;
      const value = readActive(operation.value);
      if (value === null) return null;
      active = value;
    } else if (isDynamicRecord(operation.value) && operation.value.active !== undefined) {
      const value = readActive(operation.value.active);
      if (value === null) return null;
      active = value;
    }
  }
  return active;
}

const scimConnection = Effect.fn("Scim.connection")(function* (request: Request) {
  return yield* requestCompanySignIn().scimConnection(bearerToken(request));
});

export const listScimUsers = Effect.fn("Scim.listUsers")(function* (request: Request) {
  const connection = yield* scimConnection(request);
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter");
  // A provider lists users only to find one before it adds it. A list of all users is not offered.
  const match = filter ? USER_NAME_FILTER.exec(filter.trim()) : null;
  if (!match?.[1]) {
    if (filter) return scimError(400, 'Only the filter userName eq "…" is supported.', "invalidFilter");
    return scimJson({ schemas: [LIST_SCHEMA], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] });
  }
  const user = yield* requestCompanySignIn().scimUser(connection.hostId, { email: match[1] });
  const resources = user ? [representation(user, request.url)] : [];
  return scimJson({
    schemas: [LIST_SCHEMA],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  });
});

export const createScimUser = Effect.fn("Scim.createUser")(function* (request: Request) {
  const connection = yield* scimConnection(request);
  const body = yield* readJsonObject(request);
  const userName = isString(body.userName) ? body.userName : null;
  const active = body.active === undefined ? true : readActive(body.active);
  if (!userName || active === null || !(body.externalId === undefined || isString(body.externalId))) {
    return scimError(400, "The user is invalid.", "invalidValue");
  }
  const service = requestCompanySignIn();
  const existing = yield* service.scimUser(connection.hostId, { email: userName });
  if (existing && existing.externalId !== null) return scimError(409, "The user already exists.", "uniqueness");
  const user = yield* service.scimCreate(connection, {
    email: userName,
    externalId: isString(body.externalId) ? body.externalId.slice(0, 256) : null,
    active,
  });
  return scimJson(representation(user, request.url), 201);
});

export const readScimUser = Effect.fn("Scim.readUser")(function* (request: Request, userId: string) {
  const connection = yield* scimConnection(request);
  const user = yield* requestCompanySignIn().scimUser(connection.hostId, { userId });
  if (!user) return scimError(404, "The user does not exist.");
  return scimJson(representation(user, request.url));
});

/** PATCH, PUT and DELETE. Only `active` changes; other attributes belong to the OpenBot account. */
export const updateScimUser = Effect.fn("Scim.updateUser")(function* (
  request: Request,
  userId: string,
  kind: "patch" | "put" | "delete",
) {
  const connection = yield* scimConnection(request);
  const service = requestCompanySignIn();
  const user = yield* service.scimUser(connection.hostId, { userId });
  if (!user) return scimError(404, "The user does not exist.");
  let active: boolean | undefined | null = false;
  if (kind !== "delete") {
    const body = yield* readJsonObject(request);
    active = kind === "patch" ? patchActive(body) : body.active === undefined ? undefined : readActive(body.active);
  }
  if (active === null) return scimError(400, "The request is invalid.", "invalidValue");
  if (active !== undefined && active !== user.active) yield* service.scimSetActive(connection, user.id, active);
  if (kind === "delete") return new Response(null, { status: 204 });
  return scimJson(representation({ ...user, active: active ?? user.active }, request.url));
});
