import {
  type HostedSiteRouteManifest,
  hostedSiteBlockKey,
  hostedSiteDeploymentPrefix,
  hostedSiteRouteKey,
} from "@openbot/contracts/hosted-sites";
import { Effect, Result } from "effect";
import { sha256 } from "./crypto";
import {
  expectedFile,
  HOSTED_SITE_LIMITS,
  HostedSiteInputError,
  type HostedSiteUploadRequest,
} from "./hosted-site-contract";
import { type HostedSiteFailure, HostedSiteStorage, siteCall, siteDecode, siteFailure } from "./hosted-site-effects";
import {
  assetKey,
  batchResult,
  creationCount,
  type DeploymentRow,
  deploymentResultIds,
  descriptiveSlug,
  type HostedSiteSummary,
  inactiveSiteError,
  mapSite,
  parseManifest,
  parseStoredSiteSummary,
  randomBase32,
  readUploadBody,
  type SiteRow,
  siteRouteIdentity,
  slugWords,
  sourceIpHash,
  uploadRequestHash,
} from "./hosted-site-records";
import { type HostedSiteScope, hostedSiteLimit, scopeServerId } from "./hosted-site-server";

export interface HostedSiteUploadSession {
  uploadId: string;
  site: HostedSiteSummary;
  expiresAt: string;
}

type OperationClaim = { status: "pending"; token: string } | { status: "completed"; response: string };

const CLEANUP_BATCH_SIZE = 50;
const CLEANUP_RUNTIME_BUDGET_MS = 20_000;

export class HostedSiteService {
  constructor(
    private readonly database: D1Database,
    private readonly bucket: R2Bucket,
    private readonly now: () => number = Date.now,
    private readonly reportHashSecret?: string,
    private readonly localSiteOrigin?: string,
  ) {}

  /** The sites of the scope, with the limit and slot count of the server that new sites go to. */

  readonly list = Effect.fn("HostedSites.list")(
    { self: this },
    function* (scope: HostedSiteScope) {
      const { database } = yield* HostedSiteStorage;

      const now = this.now();
      const serverId = scopeServerId(scope);
      const serverFilter = scope.kind === "account" ? "" : "AND s.server_id IS ?";
      const binds: unknown[] = scope.kind === "account" ? [scope.userId, now] : [scope.userId, now, serverId];
      const rows = yield* siteCall(() =>
        database
          .prepare(
            `SELECT s.*, COALESCE(d.file_count, 0) AS file_count, COALESCE(d.total_bytes, 0) AS total_bytes
         FROM hosted_sites s LEFT JOIN site_deployments d ON d.id = s.current_deployment_id
         WHERE s.user_id = ? AND s.status IN ('active', 'blocked') AND s.expires_at > ? ${serverFilter}
         ORDER BY s.updated_at DESC`,
          )
          .bind(...binds)
          .all<SiteRow & { file_count: number; total_bytes: number }>(),
      );
      const [limit, used] = yield* Effect.all(
        [hostedSiteLimit(database, serverId, now), this.activeSiteSlotCountEffect(scope.userId, serverId, null, now)],
        { concurrency: "unbounded" },
      );
      return { sites: rows.results.map((row) => mapSite(row, this.localSiteOrigin)), limit, used };
    },
    (operation) => operation.pipe(Effect.provide(HostedSiteStorage.layer(this.database, this.bucket))),
  );

  readonly createUpload = Effect.fn("HostedSites.createUpload")(
    { self: this },
    function* (scope: HostedSiteScope, request: HostedSiteUploadRequest, idempotencyKey: string) {
      const { database } = yield* HostedSiteStorage;

      const userId = scope.userId;
      const serverId = scopeServerId(scope);
      const requestHash = yield* uploadRequestHash(request);
      const prior = yield* this.deploymentByIdempotencyEffect(userId, idempotencyKey);
      if (prior) return yield* this.uploadSessionForRequestEffect(prior, requestHash);
      const now = this.now();
      yield* this.abandonExpiredUploadsEffect(userId, now);
      const concurrent = yield* siteCall(() =>
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM site_deployments WHERE user_id = ? AND status = 'uploading' AND upload_expires_at > ?",
          )
          .bind(userId, now)
          .first<{ count: number }>(),
      );
      if ((concurrent?.count ?? 0) >= HOSTED_SITE_LIMITS.concurrentUploads) {
        return yield* new HostedSiteInputError(
          429,
          "upload_session_limit",
          "Finish or wait for an existing upload first.",
        );
      }

      const deploymentId = crypto.randomUUID();
      const uploadExpiresAt = now + HOSTED_SITE_LIMITS.uploadLifetimeMs;
      const totalBytes = request.files.reduce((sum, file) => sum + file.size, 0);
      if (request.siteId) {
        const site = yield* this.requireOwnedSiteEffect(userId, request.siteId);
        yield* siteDecode(() => requireSiteInBucket(site, serverId));
        if (!site.expires_at || site.expires_at <= now) return yield* inactiveSiteError("expired");
        const spaFallback = request.spaFallback ?? site.spa_fallback === 1;
        const operation1 = yield* Effect.gen({ self: this }, function* () {
          return yield* siteCall(() =>
            database
              .prepare(
                `INSERT INTO site_deployments(
            id, site_id, user_id, status, base_deployment_id, file_count, total_bytes, manifest_json,
            site_title, site_description, site_framework, site_spa_fallback,
            idempotency_key, request_hash, created_at, upload_expires_at
          ) SELECT ?, ?, ?, 'uploading', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE (SELECT COUNT(*) FROM site_deployments
                   WHERE user_id = ? AND status = 'uploading' AND upload_expires_at > ?) < ?
              AND EXISTS (
                SELECT 1 FROM hosted_sites
                WHERE id = ? AND user_id = ? AND status = 'active' AND expires_at > ?
                  AND current_deployment_id IS ?
              )`,
              )
              .bind(
                deploymentId,
                site.id,
                userId,
                site.current_deployment_id,
                request.files.length,
                totalBytes,
                JSON.stringify(request.files),
                request.title,
                request.description,
                request.framework,
                spaFallback ? 1 : 0,
                idempotencyKey,
                requestHash,
                now,
                uploadExpiresAt,
                userId,
                now,
                HOSTED_SITE_LIMITS.concurrentUploads,
                site.id,
                userId,
                now,
                site.current_deployment_id,
              )
              .run(),
          );
        }).pipe(Effect.result);
        if (Result.isFailure(operation1)) {
          const error = operation1.failure;
          return yield* this.recoverConcurrentUploadEffect(userId, idempotencyKey, requestHash, error);
        }
        const insert = operation1.success;
        if (insert.meta.changes !== 1) {
          const currentSite = yield* this.requireOwnedSiteEffect(userId, site.id, true);
          if (currentSite.status !== "active") return yield* inactiveSiteError(currentSite.status);
          if (!currentSite.expires_at || currentSite.expires_at <= now) return yield* inactiveSiteError("expired");
          if (currentSite.current_deployment_id !== site.current_deployment_id) {
            return yield* new HostedSiteInputError(409, "activation_superseded", "A newer site deployment is active.");
          }
          return yield* new HostedSiteInputError(
            429,
            "upload_session_limit",
            "Finish or wait for an existing upload first.",
          );
        }
        return yield* this.uploadSessionEffect(yield* this.requireDeploymentEffect(userId, deploymentId));
      }

      yield* this.enforceCreationRateEffect(userId, now);
      const siteLimit = yield* hostedSiteLimit(database, serverId, now);
      const siteId = crypto.randomUUID();
      const hostname = yield* this.uniqueHostnameEffect(`${request.title} ${request.description}`);
      const statements = [
        database
          .prepare(
            `INSERT INTO hosted_sites(
             id, user_id, server_id, hostname, title, description, framework, spa_fallback, status,
             created_at, updated_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?
           WHERE (SELECT COUNT(*) FROM hosted_sites
                  WHERE user_id = ? AND server_id IS ? AND status IN ('uploading', 'active', 'blocked')
                    AND (expires_at IS NULL OR expires_at > ?)) < ?
             AND (SELECT COUNT(*) FROM site_deployments
                  WHERE user_id = ? AND status = 'uploading' AND upload_expires_at > ?) < ?
             AND (SELECT COUNT(*) FROM site_creation_events WHERE user_id = ? AND created_at > ?) < ?
             AND (SELECT COUNT(*) FROM site_creation_events WHERE user_id = ? AND created_at > ?) < ?`,
          )
          .bind(
            siteId,
            userId,
            serverId,
            hostname,
            request.title,
            request.description,
            request.framework,
            request.spaFallback === true ? 1 : 0,
            now,
            now,
            userId,
            serverId,
            now,
            siteLimit,
            userId,
            now,
            HOSTED_SITE_LIMITS.concurrentUploads,
            userId,
            now - 3_600_000,
            HOSTED_SITE_LIMITS.creationsPerHour,
            userId,
            now - 86_400_000,
            HOSTED_SITE_LIMITS.creationsPerDay,
          ),
        database
          .prepare(
            `INSERT INTO site_deployments(
            id, site_id, user_id, status, base_deployment_id, file_count, total_bytes, manifest_json,
            site_title, site_description, site_framework, site_spa_fallback,
            idempotency_key, request_hash, created_at, upload_expires_at
          ) SELECT ?, ?, ?, 'uploading', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM hosted_sites WHERE id = ? AND user_id = ?)
              AND (SELECT COUNT(*) FROM site_deployments
                   WHERE user_id = ? AND status = 'uploading' AND upload_expires_at > ?) < ?`,
          )
          .bind(
            deploymentId,
            siteId,
            userId,
            request.files.length,
            totalBytes,
            JSON.stringify(request.files),
            request.title,
            request.description,
            request.framework,
            request.spaFallback === true ? 1 : 0,
            idempotencyKey,
            requestHash,
            now,
            uploadExpiresAt,
            siteId,
            userId,
            userId,
            now,
            HOSTED_SITE_LIMITS.concurrentUploads,
          ),
        database
          .prepare(
            `INSERT INTO site_hostname_reservations(hostname, created_at)
           SELECT hostname, ? FROM hosted_sites WHERE id = ? AND user_id = ?`,
          )
          .bind(now, siteId, userId),
        database
          .prepare(
            `INSERT INTO site_creation_events(id, user_id, created_at)
           SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM hosted_sites WHERE id = ? AND user_id = ?)`,
          )
          .bind(siteId, userId, now, siteId, userId),
      ];
      const operation2 = yield* Effect.gen({ self: this }, function* () {
        return yield* siteCall(() => database.batch(statements));
      }).pipe(Effect.result);
      if (Result.isFailure(operation2)) {
        const error = operation2.failure;
        return yield* this.recoverConcurrentUploadEffect(userId, idempotencyKey, requestHash, error);
      }
      const results = operation2.success;
      const [siteInsert, deploymentInsert, hostnameReservation, creationEvent] = results;
      if (
        (yield* siteDecode(() => batchResult(siteInsert))).meta.changes !== 1 ||
        (yield* siteDecode(() => batchResult(deploymentInsert))).meta.changes !== 1 ||
        (yield* siteDecode(() => batchResult(hostnameReservation))).meta.changes !== 1 ||
        (yield* siteDecode(() => batchResult(creationEvent))).meta.changes !== 1
      ) {
        const currentUploads = yield* siteCall(() =>
          database
            .prepare(
              "SELECT COUNT(*) AS count FROM site_deployments WHERE user_id = ? AND status = 'uploading' AND upload_expires_at > ?",
            )
            .bind(userId, now)
            .first<{ count: number }>(),
        );
        if ((currentUploads?.count ?? 0) >= HOSTED_SITE_LIMITS.concurrentUploads) {
          return yield* new HostedSiteInputError(
            429,
            "upload_session_limit",
            "Finish or wait for an existing upload first.",
          );
        }
        yield* this.enforceCreationRateEffect(userId, now);
        return yield* siteLimitError(serverId, siteLimit);
      }
      return yield* this.uploadSessionEffect(yield* this.requireDeploymentEffect(userId, deploymentId));
    },
    (operation) => operation.pipe(Effect.provide(HostedSiteStorage.layer(this.database, this.bucket))),
  );

  readonly uploadFile = Effect.fn("HostedSites.uploadFile")(
    { self: this },
    function* (userId: string, uploadId: string, path: string, request: Request) {
      const { database, bucket } = yield* HostedSiteStorage;

      const deployment = yield* this.requireDeploymentEffect(userId, uploadId);
      if (deployment.status !== "uploading" || deployment.upload_expires_at <= this.now()) {
        return yield* new HostedSiteInputError(409, "upload_expired", "This upload session has expired.");
      }
      const files = yield* siteDecode(() => parseManifest(deployment.manifest_json));
      const file = yield* siteDecode(() => expectedFile(files, path));
      const contentLengthHeader = request.headers.get("Content-Length");
      if (contentLengthHeader === null) {
        return yield* new HostedSiteInputError(400, "size_mismatch", "The file size does not match the manifest.");
      }
      const contentLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(contentLength) || contentLength !== file.size) {
        return yield* new HostedSiteInputError(400, "size_mismatch", "The file size does not match the manifest.");
      }
      const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== file.mimeType) {
        return yield* new HostedSiteInputError(400, "mime_mismatch", "The file type does not match the manifest.");
      }
      const uploadBody = request.body;
      if (!uploadBody) return yield* new HostedSiteInputError(400, "missing_file", "The file body is missing.");
      const key = assetKey(deployment.site_id, deployment.id, file.path);
      const uploaded = yield* siteCall(() =>
        database
          .prepare("SELECT size, mime_type FROM site_upload_files WHERE deployment_id = ? AND path = ?")
          .bind(deployment.id, file.path)
          .first<{ size: number; mime_type: string }>(),
      );
      if (uploaded?.size === file.size && uploaded.mime_type === file.mimeType) {
        const stored = yield* siteCall(() => bucket.head(key));
        if (stored?.size === file.size && stored.httpMetadata?.contentType === file.mimeType) return;
      }
      const claimTime = this.now();
      const uploadClaim = yield* siteCall(() =>
        database
          .prepare(
            `UPDATE site_deployments
         SET in_flight_uploads = in_flight_uploads + 1,
             upload_claims = upload_claims + 1,
             upload_bytes_claimed = upload_bytes_claimed + ?
         WHERE id = ? AND user_id = ? AND status = 'uploading' AND upload_expires_at > ?
           AND upload_claims < file_count * ?
           AND upload_bytes_claimed + ? <= total_bytes * ?
           AND (
             SELECT COALESCE(SUM(candidate.in_flight_uploads), 0)
             FROM site_deployments candidate
             WHERE candidate.user_id = ? AND candidate.status = 'uploading' AND candidate.upload_expires_at > ?
           ) < ?
           AND (
             SELECT COALESCE(SUM(candidate.upload_claims), 0)
             FROM site_deployments candidate
             WHERE candidate.user_id = ? AND candidate.status = 'uploading' AND candidate.upload_expires_at > ?
           ) < (
             SELECT COALESCE(SUM(candidate.file_count), 0) * ?
             FROM site_deployments candidate
             WHERE candidate.user_id = ? AND candidate.status = 'uploading' AND candidate.upload_expires_at > ?
           )
           AND (
             SELECT COALESCE(SUM(candidate.upload_bytes_claimed), 0)
             FROM site_deployments candidate
             WHERE candidate.user_id = ? AND candidate.status = 'uploading' AND candidate.upload_expires_at > ?
           ) + ? <= (
             SELECT COALESCE(SUM(candidate.total_bytes), 0) * ?
             FROM site_deployments candidate
             WHERE candidate.user_id = ? AND candidate.status = 'uploading' AND candidate.upload_expires_at > ?
           )`,
          )
          .bind(
            file.size,
            deployment.id,
            userId,
            claimTime,
            HOSTED_SITE_LIMITS.uploadAttemptMultiplier,
            file.size,
            HOSTED_SITE_LIMITS.uploadAttemptMultiplier,
            userId,
            claimTime,
            HOSTED_SITE_LIMITS.concurrentFileUploads,
            userId,
            claimTime,
            HOSTED_SITE_LIMITS.uploadAttemptMultiplier,
            userId,
            claimTime,
            userId,
            claimTime,
            file.size,
            HOSTED_SITE_LIMITS.uploadAttemptMultiplier,
            userId,
            claimTime,
          )
          .run(),
      );
      if (uploadClaim.meta.changes !== 1) {
        const current = yield* this.requireDeploymentEffect(userId, deployment.id);
        if (current.status !== "uploading" || current.upload_expires_at <= this.now()) {
          return yield* new HostedSiteInputError(409, "upload_expired", "This upload session has expired.");
        }
        return yield* new HostedSiteInputError(
          429,
          "upload_rate_limit",
          "The upload retry limit for this account was reached.",
        );
      }
      yield* Effect.gen({ self: this }, function* () {
        const body = yield* readUploadBody(uploadBody, file.size);
        yield* siteCall(() => bucket.put(key, body, { httpMetadata: { contentType: file.mimeType } }));
        const stored = yield* siteCall(() => bucket.head(key));
        if (!stored || stored.size !== file.size) {
          yield* siteCall(() => bucket.delete(key));
          return yield* new HostedSiteInputError(400, "size_mismatch", "The uploaded file size is invalid.");
        }
        const storedDeployment = yield* this.requireDeploymentEffect(userId, deployment.id);
        if (storedDeployment.status !== "uploading" || storedDeployment.upload_expires_at <= this.now()) {
          yield* siteCall(() => bucket.delete(key));
          return yield* new HostedSiteInputError(409, "upload_expired", "This upload session has expired.");
        }
        yield* siteCall(() =>
          database
            .prepare(
              `INSERT INTO site_upload_files(deployment_id, path, size, mime_type, uploaded_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(deployment_id, path) DO UPDATE SET
             size = excluded.size, mime_type = excluded.mime_type, uploaded_at = excluded.uploaded_at`,
            )
            .bind(deployment.id, file.path, file.size, file.mimeType, this.now())
            .run(),
        );
      }).pipe(
        Effect.ensuring(
          Effect.gen({ self: this }, function* () {
            yield* siteCall(() =>
              database
                .prepare(
                  `UPDATE site_deployments SET in_flight_uploads = MAX(0, in_flight_uploads - 1)
           WHERE id = ? AND user_id = ?`,
                )
                .bind(deployment.id, userId)
                .run(),
            );
          }).pipe(Effect.orDie),
        ),
      );
    },
    (operation) => operation.pipe(Effect.provide(HostedSiteStorage.layer(this.database, this.bucket))),
  );

  readonly activate = Effect.fn("HostedSites.activate")(
    { self: this },
    function* (userId: string, uploadId: string, idempotencyKey: string) {
      const { database } = yield* HostedSiteStorage;

      const deployment = yield* this.requireDeploymentEffect(userId, uploadId);
      return yield* this.runClaimedOperationEffect(
        userId,
        idempotencyKey,
        "activate",
        deployment.id,
        parseStoredSiteSummary,
        (summary) => summary,
        () =>
          Effect.gen({ self: this }, function* () {
            const now = this.now();
            const site = yield* this.requireOwnedSiteEffect(userId, deployment.site_id, true);
            if (site.status !== "uploading" && site.status !== "active") {
              yield* this.abandonDeploymentEffect(deployment);
              return yield* inactiveSiteError(site.status);
            }
            if (
              (deployment.status === "uploading" || deployment.status === "activating") &&
              deployment.upload_expires_at <= now
            ) {
              yield* this.abandonDeploymentEffect(deployment);
              yield* this.deleteDeploymentEffect(site.id, deployment.id);
              yield* this.deleteEmptyUploadingSiteEffect(site.id);
              return yield* new HostedSiteInputError(409, "upload_expired", "This upload session has expired.");
            }
            if (site.status === "active" && (!site.expires_at || site.expires_at <= now)) {
              yield* this.abandonDeploymentEffect(deployment);
              yield* this.deleteDeploymentEffect(site.id, deployment.id);
              return yield* inactiveSiteError("expired");
            }
            if (deployment.status === "active") {
              if (site.current_deployment_id !== deployment.id) {
                return yield* new HostedSiteInputError(
                  409,
                  "activation_superseded",
                  "A newer site deployment is active.",
                );
              }
              yield* this.publishAuthoritativeRouteEffect(site.id);
              const summary = yield* this.summaryForSiteEffect(userId, deployment.site_id);
              if (deployment.base_deployment_id && deployment.base_deployment_id !== deployment.id) {
                yield* this.deleteDeploymentEffect(site.id, deployment.base_deployment_id);
              }
              return summary;
            }
            if (!["uploading", "activating"].includes(deployment.status) || deployment.upload_expires_at <= now) {
              return yield* new HostedSiteInputError(409, "upload_expired", "This upload session has expired.");
            }
            if (deployment.status === "uploading") {
              const uploaded = yield* siteCall(() =>
                database
                  .prepare("SELECT path, size, mime_type FROM site_upload_files WHERE deployment_id = ?")
                  .bind(deployment.id)
                  .all<{ path: string; size: number; mime_type: string }>(),
              );
              const files = yield* siteDecode(() => parseManifest(deployment.manifest_json));
              if (
                uploaded.results.length !== files.length ||
                files.some(
                  (file) =>
                    !uploaded.results.some(
                      (item) => item.path === file.path && item.size === file.size && item.mime_type === file.mimeType,
                    ),
                )
              ) {
                return yield* new HostedSiteInputError(
                  409,
                  "upload_incomplete",
                  "Upload every manifest file before activation.",
                );
              }
            }
            const expiresAt = now + HOSTED_SITE_LIMITS.siteLifetimeMs;
            const authorizedDeployment = yield* this.authorizeActivationEffect(userId, deployment, now);
            return yield* this.finalizeActivationEffect(userId, site, authorizedDeployment, expiresAt, now).pipe(
              Effect.tapError(() =>
                siteCall(() =>
                  database
                    .prepare("UPDATE site_deployments SET status = 'uploading' WHERE id = ? AND status = 'activating'")
                    .bind(deployment.id)
                    .run(),
                ),
              ),
            );
          }),
      );
    },
    (operation) => operation.pipe(Effect.provide(HostedSiteStorage.layer(this.database, this.bucket))),
  );

  readonly delete = Effect.fn("HostedSites.delete")(
    { self: this },
    function* (scope: HostedSiteScope, siteId: string, idempotencyKey: string) {
      const { database } = yield* HostedSiteStorage;

      const userId = scope.userId;
      const site = yield* this.requireOwnedSiteEffect(userId, siteId, true);
      if (scope.kind !== "account") yield* siteDecode(() => requireSiteInBucket(site, scopeServerId(scope)));
      if (site.status === "deleted" && (yield* this.completedDeletionEffect(userId, site.id))) return;
      return yield* this.runClaimedOperationEffect(
        userId,
        idempotencyKey,
        "delete",
        siteId,
        () => undefined,
        () => ({ deleted: true }),
        () =>
          Effect.gen({ self: this }, function* () {
            const now = this.now();
            const statements = [
              database
                .prepare(
                  `UPDATE hosted_sites SET status = 'deleted', deleted_at = ?, expires_at = NULL,
               route_synced_at = NULL, updated_at = ?
               WHERE id = ? AND user_id = ? AND status != 'deleted'`,
                )
                .bind(now, now, site.id, userId),
              database
                .prepare(
                  `UPDATE site_deployments SET status = 'abandoned'
               WHERE site_id = ? AND status IN ('uploading', 'activating', 'active', 'superseded')
                 AND EXISTS (SELECT 1 FROM hosted_sites WHERE id = ? AND status = 'deleted')
               RETURNING id`,
                )
                .bind(site.id, site.id),
            ];
            if (site.status !== "deleted") {
              statements.push(
                database
                  .prepare(
                    "INSERT INTO site_audit_log(id, user_id, site_id, operation, created_at) VALUES (?, ?, ?, 'delete', ?)",
                  )
                  .bind(crypto.randomUUID(), userId, site.id, now),
              );
            }
            const results = yield* siteCall(() => database.batch(statements));
            const deploymentIds = yield* siteDecode(() => deploymentResultIds(batchResult(results[1])));
            yield* this.publishAuthoritativeRouteEffect(site.id);
            yield* Effect.gen({ self: this }, function* () {
              yield* this.deleteBlockMarkerEffect(site.id, site.hostname);
            }).pipe(
              Effect.ensuring(
                Effect.gen({ self: this }, function* () {
                  for (const deploymentId of deploymentIds) yield* this.deleteDeploymentEffect(site.id, deploymentId);
                }).pipe(Effect.orDie),
              ),
            );
          }),
      );
    },
    (operation) => operation.pipe(Effect.provide(HostedSiteStorage.layer(this.database, this.bucket))),
  );

  readonly report = Effect.fn("HostedSites.report")(
    { self: this },
    function* (hostname: string, reason: string, details: string | null, sourceIp: string) {
      const { database } = yield* HostedSiteStorage;

      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.openbot\.site$/u.test(hostname)) {
        return yield* new HostedSiteInputError(400, "invalid_hostname", "The hosted site address is invalid.");
      }
      if (!["abuse", "malware", "phishing", "copyright", "other"].includes(reason)) {
        return yield* new HostedSiteInputError(400, "invalid_reason", "Choose a valid report reason.");
      }
      if (details !== null && details.length > 1_000) {
        return yield* new HostedSiteInputError(400, "invalid_details", "Report details are too long.");
      }
      const site = yield* siteCall(() =>
        database.prepare("SELECT id FROM hosted_sites WHERE hostname = ?").bind(hostname).first<{ id: string }>(),
      );
      if (!site) return yield* new HostedSiteInputError(404, "site_not_found", "The hosted site was not found.");
      const now = this.now();
      const deduplicationWindow = Math.floor(now / 86_400_000);
      const secret = this.reportHashSecret?.trim();
      if (!secret || secret.length < 32)
        return yield* Effect.fail(siteFailure(new Error("The hosted site report hash secret is unavailable.")));
      const ipHash = yield* sourceIpHash(secret, sourceIp, deduplicationWindow);
      const reportId = yield* sha256(`${hostname}\0${reason}\0${ipHash}\0${deduplicationWindow}`).pipe(
        Effect.mapError(siteFailure),
      );
      yield* siteCall(() =>
        database
          .prepare(
            `INSERT INTO site_reports(id, hostname, reason, details, source_ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
          )
          .bind(reportId, hostname, reason, details, ipHash, now)
          .run(),
      );
    },
    (operation) => operation.pipe(Effect.provide(HostedSiteStorage.layer(this.database, this.bucket))),
  );

  readonly setBlocked = Effect.fn("HostedSites.setBlocked")(
    { self: this },
    function* (siteId: string, blocked: boolean) {
      const { database, bucket } = yield* HostedSiteStorage;

      const site = yield* siteCall(() =>
        database.prepare("SELECT * FROM hosted_sites WHERE id = ?").bind(siteId).first<SiteRow>(),
      );
      if (!site) return yield* new HostedSiteInputError(409, "site_not_found", "The site was not found.");
      const now = this.now();
      if (blocked) {
        yield* siteCall(() =>
          bucket.put(hostedSiteBlockKey(site.hostname), "blocked", {
            httpMetadata: { contentType: "text/plain" },
          }),
        );
      }
      let status: SiteRow["status"];
      let allowedStatuses: string;
      if (blocked) {
        status = "blocked";
        allowedStatuses = "('active', 'blocked')";
      } else if (!site.current_deployment_id || !site.expires_at || site.expires_at <= now) {
        status = "expired";
        allowedStatuses = "('blocked', 'active', 'expired')";
      } else {
        status = "active";
        allowedStatuses = "('blocked', 'active')";
      }
      const operation4 = yield* Effect.gen({ self: this }, function* () {
        return yield* siteCall(() =>
          database.batch([
            database
              .prepare(
                `UPDATE hosted_sites SET status = ?, blocked_at = ?, route_synced_at = NULL, updated_at = ?
             WHERE id = ? AND status IN ${allowedStatuses} AND (? = 0 OR expires_at > ?)`,
              )
              .bind(status, blocked ? now : null, now, site.id, blocked ? 1 : 0, now),
            database
              .prepare(
                `UPDATE site_deployments SET status = 'abandoned'
             WHERE site_id = ? AND status IN ('uploading', 'activating') AND ? = 1
               AND EXISTS (
                 SELECT 1 FROM hosted_sites WHERE id = ? AND status = ? AND updated_at = ?
               )
             RETURNING id`,
              )
              .bind(site.id, blocked ? 1 : 0, site.id, status, now),
            database
              .prepare(
                `INSERT INTO site_audit_log(id, user_id, site_id, operation, created_at)
             SELECT ?, NULL, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM hosted_sites WHERE id = ? AND status = ? AND updated_at = ?
             )`,
              )
              .bind(crypto.randomUUID(), site.id, blocked ? "block" : "unblock", now, site.id, status, now),
          ]),
        );
      }).pipe(Effect.result);
      if (Result.isFailure(operation4)) {
        const error = operation4.failure;
        if (blocked) yield* siteCall(() => bucket.delete(hostedSiteBlockKey(site.hostname)).catch(() => undefined));
        return yield* Effect.fail(siteFailure(error));
      }
      const results = operation4.success;
      if ((yield* siteDecode(() => batchResult(results[0]))).meta.changes !== 1) {
        if (blocked) yield* siteCall(() => bucket.delete(hostedSiteBlockKey(site.hostname)).catch(() => undefined));
        const current = yield* this.siteByIdEffect(site.id);
        if (current?.status === "deleted" || current?.status === "expired")
          return yield* inactiveSiteError(current.status);
        if (current?.expires_at != null && current.expires_at <= now) return yield* inactiveSiteError("expired");
        return yield* new HostedSiteInputError(409, "site_not_active", "This site cannot be blocked or unblocked.");
      }
      yield* this.reconcileRouteAndMarkerEffect(site.id);
      for (const deploymentId of yield* siteDecode(() => deploymentResultIds(batchResult(results[1])))) {
        yield* this.deleteDeploymentEffect(site.id, deploymentId);
      }
    },
    (operation) => operation.pipe(Effect.provide(HostedSiteStorage.layer(this.database, this.bucket))),
  );

  cleanup(now = this.now()) {
    return Effect.fn("HostedSites.cleanup")({ self: this }, function* () {
      const { database, bucket } = yield* HostedSiteStorage;

      const deadline = performance.now() + CLEANUP_RUNTIME_BUDGET_MS;
      let abandonedUploads = 0;
      let expiredSites = 0;
      let deletedTombstones = 0;
      const tombstoneCutoff = now - HOSTED_SITE_LIMITS.tombstoneLifetimeMs;
      let hasMore = true;
      cleanupBatches: while (hasMore && performance.now() < deadline) {
        hasMore = false;
        const staleUploads = yield* siteCall(() =>
          database
            .prepare(
              `SELECT id, site_id FROM site_deployments
           WHERE status IN ('uploading', 'activating') AND upload_expires_at <= ?
           LIMIT ${CLEANUP_BATCH_SIZE}`,
            )
            .bind(now)
            .all<{ id: string; site_id: string }>(),
        );
        hasMore ||= staleUploads.results.length === CLEANUP_BATCH_SIZE;
        for (const upload of staleUploads.results) {
          if (performance.now() >= deadline) break cleanupBatches;
          const claim = yield* siteCall(() =>
            database
              .prepare(
                `UPDATE site_deployments SET status = 'abandoned'
             WHERE id = ? AND status IN ('uploading', 'activating') AND upload_expires_at <= ?`,
              )
              .bind(upload.id, now)
              .run(),
          );
          if (claim.meta.changes !== 1) continue;
          abandonedUploads += 1;
          yield* this.deleteDeploymentEffect(upload.site_id, upload.id);
        }

        const unsyncedSites = yield* siteCall(() =>
          database
            .prepare(
              `SELECT id, hostname FROM hosted_sites
           WHERE status IN ('active', 'blocked', 'deleted', 'expired') AND route_synced_at IS NULL
           ORDER BY updated_at, id LIMIT ${CLEANUP_BATCH_SIZE}`,
            )
            .all<{ id: string; hostname: string }>(),
        );
        hasMore ||= unsyncedSites.results.length === CLEANUP_BATCH_SIZE;
        for (const site of unsyncedSites.results) {
          if (performance.now() >= deadline) break cleanupBatches;
          yield* this.reconcileRouteAndMarkerEffect(site.id);
        }

        const obsoleteDeployments = yield* siteCall(() =>
          database
            .prepare(
              `SELECT deployment.id, deployment.site_id FROM site_deployments AS deployment
           WHERE deployment.status IN ('abandoned', 'superseded')
             AND deployment.objects_deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM hosted_sites AS site
               WHERE site.id = deployment.site_id AND site.route_synced_at IS NULL
             )
           LIMIT ${CLEANUP_BATCH_SIZE}`,
            )
            .all<{ id: string; site_id: string }>(),
        );
        hasMore ||= obsoleteDeployments.results.length === CLEANUP_BATCH_SIZE;
        for (const deployment of obsoleteDeployments.results) {
          if (performance.now() >= deadline) break cleanupBatches;
          yield* this.deleteDeploymentEffect(deployment.site_id, deployment.id);
        }
        yield* siteCall(() =>
          database
            .prepare(
              `DELETE FROM hosted_sites WHERE status = 'uploading'
           AND NOT EXISTS (
             SELECT 1 FROM site_deployments d
             WHERE d.site_id = hosted_sites.id AND d.status IN ('uploading', 'activating')
           )`,
            )
            .run(),
        );

        const expired = yield* siteCall(() =>
          database
            .prepare(
              `SELECT * FROM hosted_sites
           WHERE status IN ('active', 'blocked') AND expires_at <= ? LIMIT ${CLEANUP_BATCH_SIZE}`,
            )
            .bind(now)
            .all<SiteRow>(),
        );
        hasMore ||= expired.results.length === CLEANUP_BATCH_SIZE;
        for (const site of expired.results) {
          if (performance.now() >= deadline) break cleanupBatches;
          const results = yield* siteCall(() =>
            database.batch([
              database
                .prepare(
                  `UPDATE hosted_sites SET status = 'expired', route_synced_at = NULL, updated_at = ?
               WHERE id = ? AND status IN ('active', 'blocked') AND expires_at <= ?`,
                )
                .bind(now, site.id, now),
              database
                .prepare(
                  `UPDATE site_deployments SET status = 'abandoned'
               WHERE site_id = ? AND status IN ('uploading', 'activating')
                 AND EXISTS (SELECT 1 FROM hosted_sites WHERE id = ? AND status = 'expired')`,
                )
                .bind(site.id, site.id),
            ]),
          );
          if ((yield* siteDecode(() => batchResult(results[0]))).meta.changes !== 1) continue;
          expiredSites += 1;
          yield* Effect.gen({ self: this }, function* () {
            yield* this.publishAuthoritativeRouteEffect(site.id);
          }).pipe(
            Effect.ensuring(
              Effect.gen({ self: this }, function* () {
                yield* this.deleteBlockMarkerEffect(site.id, site.hostname);
              }).pipe(Effect.orDie),
            ),
          );
          const current = yield* this.siteByIdEffect(site.id);
          if (current?.current_deployment_id)
            yield* this.deleteDeploymentEffect(site.id, current.current_deployment_id);
        }

        const tombstones = yield* siteCall(() =>
          database
            .prepare(
              `SELECT id, hostname FROM hosted_sites
           WHERE status IN ('deleted', 'expired') AND updated_at <= ? LIMIT ${CLEANUP_BATCH_SIZE}`,
            )
            .bind(tombstoneCutoff)
            .all<{ id: string; hostname: string }>(),
        );
        hasMore ||= tombstones.results.length === CLEANUP_BATCH_SIZE;
        const processedTombstones: { id: string }[] = [];
        for (const site of tombstones.results) {
          if (performance.now() >= deadline) break;
          yield* siteCall(() => bucket.delete([hostedSiteRouteKey(site.hostname), hostedSiteBlockKey(site.hostname)]));
          processedTombstones.push(site);
        }
        if (processedTombstones.length) {
          const results = yield* siteCall(() =>
            database.batch(
              processedTombstones.map((site) =>
                database.prepare("DELETE FROM hosted_sites WHERE id = ?").bind(site.id),
              ),
            ),
          );
          deletedTombstones += results.reduce((total, result) => total + result.meta.changes, 0);
        }
      }
      yield* siteCall(() =>
        database
          .prepare("DELETE FROM site_creation_events WHERE created_at < ?")
          .bind(now - 2 * 24 * 60 * 60_000)
          .run(),
      );
      yield* siteCall(() =>
        database
          .prepare("DELETE FROM site_operation_receipts WHERE created_at < ?")
          .bind(now - 90 * 24 * 60 * 60_000)
          .run(),
      );
      yield* siteCall(() =>
        database
          .prepare("DELETE FROM site_reports WHERE created_at < ?")
          .bind(now - 180 * 24 * 60 * 60_000)
          .run(),
      );
      return {
        uploads: abandonedUploads,
        expired: expiredSites,
        tombstones: deletedTombstones,
      };
    })().pipe(Effect.provide(HostedSiteStorage.layer(this.database, this.bucket)));
  }

  private readonly finalizeActivationEffect = Effect.fn("HostedSites.finalizeActivation")(
    { self: this },
    function* (
      userId: string,
      site: SiteRow,
      deployment: DeploymentRow,
      expiresAt: number,
      now: number,
    ): Effect.fn.Return<HostedSiteSummary, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      const previousDeployment = deployment.base_deployment_id;
      // The site keeps the server it was created for, so the activation counts against that server's plan.
      const siteLimit = yield* hostedSiteLimit(database, site.server_id, now);
      const results = yield* siteCall(() =>
        database.batch([
          database
            .prepare(
              `UPDATE hosted_sites SET status = 'active', current_deployment_id = ?, expires_at = ?,
           route_synced_at = NULL,
           updated_at = ?, title = ?, description = ?, framework = ?, spa_fallback = ?
           WHERE id = ? AND user_id = ? AND status IN ('uploading', 'active')
             AND (status = 'uploading' OR expires_at > ?)
             AND (
               -- An active site already holds its slot, so a replacement is allowed after a downgrade.
               status = 'active' OR (
                 SELECT COUNT(*) FROM hosted_sites
                 WHERE user_id = ? AND server_id IS ? AND id != ? AND status IN ('uploading', 'active', 'blocked')
                   AND (expires_at IS NULL OR expires_at > ?)
               ) < ?
             )
             AND current_deployment_id IS ?
             AND EXISTS (SELECT 1 FROM site_deployments WHERE id = ? AND status = 'activating')`,
            )
            .bind(
              deployment.id,
              expiresAt,
              now,
              deployment.site_title,
              deployment.site_description,
              deployment.site_framework,
              deployment.site_spa_fallback,
              site.id,
              userId,
              now,
              userId,
              site.server_id,
              site.id,
              now,
              siteLimit,
              previousDeployment,
              deployment.id,
            ),
          database
            .prepare(
              `INSERT INTO site_audit_log(id, user_id, site_id, operation, created_at)
           SELECT ?, ?, ?, 'activate', ?
           WHERE EXISTS (SELECT 1 FROM site_deployments WHERE id = ? AND status = 'activating')
             AND EXISTS (
               SELECT 1 FROM hosted_sites WHERE id = ? AND user_id = ? AND status = 'active'
                 AND current_deployment_id = ?
             )`,
            )
            .bind(crypto.randomUUID(), userId, site.id, now, deployment.id, site.id, userId, deployment.id),
          database
            .prepare(
              `UPDATE site_deployments SET status = 'superseded'
           WHERE site_id = ? AND id != ? AND status = 'active'
             AND EXISTS (SELECT 1 FROM site_deployments WHERE id = ? AND status = 'activating')
             AND EXISTS (
               SELECT 1 FROM hosted_sites WHERE id = ? AND user_id = ? AND status = 'active'
                 AND current_deployment_id = ?
             )`,
            )
            .bind(site.id, deployment.id, deployment.id, site.id, userId, deployment.id),
          database
            .prepare(
              `UPDATE site_deployments SET status = 'active', activated_at = ?
           WHERE id = ? AND status = 'activating'
             AND EXISTS (
               SELECT 1 FROM hosted_sites WHERE id = ? AND user_id = ? AND status = 'active'
                 AND current_deployment_id = ?
             )`,
            )
            .bind(now, deployment.id, site.id, userId, deployment.id),
          database
            .prepare(
              `UPDATE site_deployments SET status = 'abandoned'
           WHERE site_id = ? AND id != ? AND status IN ('uploading', 'activating')
             AND base_deployment_id IS ?
             AND EXISTS (
               SELECT 1 FROM hosted_sites WHERE id = ? AND user_id = ? AND status = 'active'
                 AND current_deployment_id = ?
             )
           RETURNING id`,
            )
            .bind(site.id, deployment.id, previousDeployment, site.id, userId, deployment.id),
        ]),
      );
      if ((yield* siteDecode(() => batchResult(results[3]))).meta.changes !== 1) {
        const currentSite = yield* this.requireOwnedSiteEffect(userId, site.id, true);
        const currentDeployment = yield* this.requireDeploymentEffect(userId, deployment.id);
        const alreadyActive =
          currentSite.status === "active" &&
          currentSite.current_deployment_id === deployment.id &&
          currentDeployment.status === "active";
        if (!alreadyActive) {
          yield* this.abandonDeploymentEffect(currentDeployment);
          if (currentSite.status !== "uploading") yield* this.publishAuthoritativeRouteEffect(site.id);
          yield* this.deleteDeploymentEffect(site.id, deployment.id);
          if (currentSite.status !== "uploading" && currentSite.status !== "active") {
            return yield* inactiveSiteError(currentSite.status);
          }
          if (currentDeployment.upload_expires_at <= now) {
            return yield* new HostedSiteInputError(409, "upload_expired", "This upload session has expired.");
          }
          if (currentSite.status === "active" && (!currentSite.expires_at || currentSite.expires_at <= now)) {
            return yield* inactiveSiteError("expired");
          }
          if (
            currentSite.status === "uploading" &&
            (yield* this.activeSiteSlotCountEffect(userId, site.server_id, site.id, now)) >= siteLimit
          ) {
            return yield* siteLimitError(site.server_id, siteLimit);
          }
          return yield* new HostedSiteInputError(409, "activation_superseded", "A newer site deployment is active.");
        }
      }
      yield* this.publishAuthoritativeRouteEffect(site.id);
      const summary = yield* this.summaryForSiteEffect(userId, site.id);
      if (previousDeployment && previousDeployment !== deployment.id) {
        yield* this.deleteDeploymentEffect(site.id, previousDeployment);
      }
      for (const abandonedDeploymentId of yield* siteDecode(() => deploymentResultIds(batchResult(results[4])))) {
        yield* this.deleteDeploymentEffect(site.id, abandonedDeploymentId);
      }
      return summary;
    },
  );

  private readonly abandonDeploymentEffect = Effect.fn("HostedSites.abandonDeployment")(
    { self: this },
    function* (deployment: DeploymentRow): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      yield* siteCall(() =>
        database
          .prepare(
            `UPDATE site_deployments SET status = 'abandoned'
         WHERE id = ? AND status IN ('uploading', 'activating')`,
          )
          .bind(deployment.id)
          .run(),
      );
    },
  );

  private readonly deleteEmptyUploadingSiteEffect = Effect.fn("HostedSites.deleteEmptyUploadingSite")(
    { self: this },
    function* (siteId: string): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      yield* siteCall(() =>
        database
          .prepare(
            `DELETE FROM hosted_sites
         WHERE id = ? AND status = 'uploading' AND current_deployment_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM site_deployments d
             WHERE d.site_id = hosted_sites.id AND d.status IN ('uploading', 'activating')
           )`,
          )
          .bind(siteId)
          .run(),
      );
    },
  );

  private readonly publishAuthoritativeRouteEffect = Effect.fn("HostedSites.publishAuthoritativeRoute")(
    { self: this },
    function* (siteId: string): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { bucket, database } = yield* HostedSiteStorage;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const before = yield* this.siteByIdEffect(siteId);
        if (!before) return yield* new HostedSiteInputError(409, "site_not_found", "The site was not found.");
        const route = yield* this.routeForSiteEffect(before);
        yield* siteCall(() =>
          bucket.put(hostedSiteRouteKey(before.hostname), JSON.stringify(route), {
            httpMetadata: { contentType: "application/json" },
          }),
        );
        const after = yield* this.siteByIdEffect(siteId);
        if (after && siteRouteIdentity(after) === siteRouteIdentity(before)) {
          yield* siteCall(() =>
            database
              .prepare(
                `UPDATE hosted_sites SET route_synced_at = ?
             WHERE id = ? AND status = ? AND current_deployment_id IS ? AND expires_at IS ?`,
              )
              .bind(this.now(), before.id, before.status, before.current_deployment_id, before.expires_at)
              .run(),
          );
          return;
        }
      }
      return yield* Effect.fail(siteFailure(new Error("The site route changed too often during publication.")));
    },
  );

  private readonly routeForSiteEffect = Effect.fn("HostedSites.routeForSite")(
    { self: this },
    function* (site: SiteRow): Effect.fn.Return<HostedSiteRouteManifest, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      if (site.status !== "active") {
        if (site.status === "uploading")
          return yield* Effect.fail(siteFailure(new Error("An uploading site does not have a public route.")));
        return {
          version: 1,
          status: site.status,
          siteId: site.id,
          deploymentId: null,
          expiresAt: site.expires_at,
          spaFallback: false,
          files: {},
        };
      }
      if (!site.current_deployment_id)
        return yield* Effect.fail(siteFailure(new Error("The active site deployment is missing.")));
      const deployment = yield* siteCall(() =>
        database
          .prepare("SELECT * FROM site_deployments WHERE id = ? AND site_id = ? AND status = 'active'")
          .bind(site.current_deployment_id, site.id)
          .first<DeploymentRow>(),
      );
      if (!deployment) return yield* Effect.fail(siteFailure(new Error("The active deployment is missing.")));
      const files = yield* siteDecode(() => parseManifest(deployment.manifest_json));
      return {
        version: 1,
        status: "active",
        siteId: site.id,
        deploymentId: deployment.id,
        expiresAt: site.expires_at,
        spaFallback: deployment.site_spa_fallback === 1,
        files: Object.fromEntries(
          files.map((file) => [
            file.path,
            { key: assetKey(site.id, deployment.id, file.path), size: file.size, mimeType: file.mimeType },
          ]),
        ),
      };
    },
  );

  private readonly siteByIdEffect = Effect.fn("HostedSites.siteById")(
    { self: this },
    function* (siteId: string): Effect.fn.Return<SiteRow | null, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      return yield* siteCall(() =>
        database.prepare("SELECT * FROM hosted_sites WHERE id = ?").bind(siteId).first<SiteRow>(),
      );
    },
  );

  /** The sites that hold a slot of one server, or of the unlinked bucket when `serverId` is null. */
  private readonly activeSiteSlotCountEffect = Effect.fn("HostedSites.activeSiteSlotCount")(
    { self: this },
    function* (
      userId: string,
      serverId: string | null,
      excludeSiteId: string | null,
      now: number,
    ): Effect.fn.Return<number, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      const row = yield* siteCall(() =>
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM hosted_sites
         WHERE user_id = ? AND server_id IS ? AND id IS NOT ? AND status IN ('uploading', 'active', 'blocked')
           AND (expires_at IS NULL OR expires_at > ?)`,
          )
          .bind(userId, serverId, excludeSiteId, now)
          .first<{ count: number }>(),
      );
      return row?.count ?? 0;
    },
  );

  private readonly authorizeActivationEffect = Effect.fn("HostedSites.authorizeActivation")(
    { self: this },
    function* (
      userId: string,
      deployment: DeploymentRow,
      now: number,
    ): Effect.fn.Return<DeploymentRow, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      if (deployment.activation_authorized_at !== null) {
        if (deployment.status === "activating") return deployment;
        const retryClaim = yield* siteCall(() =>
          database
            .prepare(
              `UPDATE site_deployments SET status = 'activating'
           WHERE id = ? AND user_id = ? AND status = 'uploading' AND activation_authorized_at IS NOT NULL
             AND in_flight_uploads = 0`,
            )
            .bind(deployment.id, userId)
            .run(),
        );
        if (retryClaim.meta.changes === 1) return { ...deployment, status: "activating" };
      }
      const hour = Math.floor(now / 3_600_000) * 3_600_000;
      const day = Math.floor(now / 86_400_000) * 86_400_000;
      const claim = yield* siteCall(() =>
        database
          .prepare(
            `UPDATE site_deployments SET status = 'activating', activation_authorized_at = ?
         WHERE id = ? AND user_id = ? AND status IN ('uploading', 'activating')
           AND activation_authorized_at IS NULL
           AND in_flight_uploads = 0
           AND (
             SELECT COUNT(*) FROM site_deployments
             WHERE user_id = ? AND activation_authorized_at >= ?
           ) < 20
           AND (
             SELECT COUNT(*) FROM site_deployments
             WHERE user_id = ? AND activation_authorized_at >= ?
           ) < 100`,
          )
          .bind(now, deployment.id, userId, userId, hour, userId, day)
          .run(),
      );
      if (claim.meta.changes === 1) {
        return { ...deployment, status: "activating", activation_authorized_at: now };
      }
      const current = yield* this.requireDeploymentEffect(userId, deployment.id);
      if (current.status === "activating" && current.activation_authorized_at !== null) return current;
      if (current.in_flight_uploads > 0) {
        return yield* new HostedSiteInputError(409, "upload_in_progress", "Wait for the file upload to finish.");
      }
      yield* siteCall(() =>
        database
          .prepare(
            `UPDATE site_deployments SET status = 'uploading'
         WHERE id = ? AND user_id = ? AND status = 'activating' AND activation_authorized_at IS NULL`,
          )
          .bind(deployment.id, userId)
          .run(),
      );
      return yield* new HostedSiteInputError(
        429,
        "activation_rate_limit",
        "The publish limit for this account was reached.",
      );
    },
  );

  private readonly enforceCreationRateEffect = Effect.fn("HostedSites.enforceCreationRate")(
    { self: this },
    function* (userId: string, now: number): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      const [hour, day] = yield* siteCall(() =>
        database.batch([
          database
            .prepare("SELECT COUNT(*) AS count FROM site_creation_events WHERE user_id = ? AND created_at > ?")
            .bind(userId, now - 3_600_000),
          database
            .prepare("SELECT COUNT(*) AS count FROM site_creation_events WHERE user_id = ? AND created_at > ?")
            .bind(userId, now - 86_400_000),
        ]),
      );
      const hourCount = creationCount((yield* siteDecode(() => batchResult(hour))).results?.[0]);
      const dayCount = creationCount((yield* siteDecode(() => batchResult(day))).results?.[0]);
      if (hourCount >= HOSTED_SITE_LIMITS.creationsPerHour || dayCount >= HOSTED_SITE_LIMITS.creationsPerDay) {
        return yield* new HostedSiteInputError(
          429,
          "site_creation_rate_limit",
          "The new-site creation limit for this account was reached.",
        );
      }
    },
  );

  private readonly uniqueHostnameEffect = Effect.fn("HostedSites.uniqueHostname")(
    { self: this },
    function* (source: string): Effect.fn.Return<string, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const words = slugWords(source);
        const descriptive = descriptiveSlug(words);
        const hostname = `${descriptive}-${randomBase32(10)}.openbot.site`;
        const existing = yield* siteCall(() =>
          database
            .prepare("SELECT hostname FROM site_hostname_reservations WHERE hostname = ?")
            .bind(hostname)
            .first<{ hostname: string }>(),
        );
        if (!existing) return hostname;
      }
      return yield* Effect.fail(siteFailure(new Error("A unique site hostname could not be created.")));
    },
  );

  private readonly requireOwnedSiteEffect = Effect.fn("HostedSites.requireOwnedSite")(
    { self: this },
    function* (
      userId: string,
      siteId: string,
      allowInactive = false,
    ): Effect.fn.Return<SiteRow, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      const site = yield* siteCall(() =>
        database
          .prepare("SELECT * FROM hosted_sites WHERE id = ? AND user_id = ?")
          .bind(siteId, userId)
          .first<SiteRow>(),
      );
      if (!site || (!allowInactive && site.status !== "active")) {
        return yield* new HostedSiteInputError(409, "site_not_found", "The site was not found.");
      }
      return site;
    },
  );

  private readonly requireDeploymentEffect = Effect.fn("HostedSites.requireDeployment")(
    { self: this },
    function* (
      userId: string,
      deploymentId: string,
    ): Effect.fn.Return<DeploymentRow, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      const deployment = yield* siteCall(() =>
        database
          .prepare("SELECT * FROM site_deployments WHERE id = ? AND user_id = ?")
          .bind(deploymentId, userId)
          .first<DeploymentRow>(),
      );
      if (!deployment) return yield* new HostedSiteInputError(409, "upload_not_found", "The upload was not found.");
      return deployment;
    },
  );

  private readonly deploymentByIdempotencyEffect = Effect.fn("HostedSites.deploymentByIdempotency")(
    { self: this },
    function* (
      userId: string,
      key: string,
    ): Effect.fn.Return<DeploymentRow | null, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      return yield* siteCall(() =>
        database
          .prepare("SELECT * FROM site_deployments WHERE user_id = ? AND idempotency_key = ?")
          .bind(userId, key)
          .first<DeploymentRow>(),
      );
    },
  );

  private readonly uploadSessionEffect = Effect.fn("HostedSites.uploadSession")(
    { self: this },
    function* (
      deployment: DeploymentRow,
    ): Effect.fn.Return<HostedSiteUploadSession, HostedSiteFailure, HostedSiteStorage> {
      return {
        uploadId: deployment.id,
        site: yield* this.summaryForSiteEffect(deployment.user_id, deployment.site_id),
        expiresAt: new Date(deployment.upload_expires_at).toISOString(),
      };
    },
  );

  private readonly uploadSessionForRequestEffect = Effect.fn("HostedSites.uploadSessionForRequest")(
    { self: this },
    function* (
      deployment: DeploymentRow,
      requestHash: string,
    ): Effect.fn.Return<HostedSiteUploadSession, HostedSiteFailure, HostedSiteStorage> {
      if (deployment.request_hash !== requestHash) {
        return yield* new HostedSiteInputError(
          409,
          "idempotency_conflict",
          "This idempotency key was already used for a different upload request.",
        );
      }
      return yield* this.uploadSessionEffect(deployment);
    },
  );

  private readonly summaryForSiteEffect = Effect.fn("HostedSites.summaryForSite")(
    { self: this },
    function* (
      userId: string,
      siteId: string,
    ): Effect.fn.Return<HostedSiteSummary, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      const row = yield* siteCall(() =>
        database
          .prepare(
            `SELECT s.*, COALESCE(d.file_count, 0) AS file_count, COALESCE(d.total_bytes, 0) AS total_bytes
         FROM hosted_sites s LEFT JOIN site_deployments d ON d.id = s.current_deployment_id
         WHERE s.id = ? AND s.user_id = ?`,
          )
          .bind(siteId, userId)
          .first<SiteRow & { file_count: number; total_bytes: number }>(),
      );
      if (!row) return yield* new HostedSiteInputError(409, "site_not_found", "The site was not found.");
      return yield* siteDecode(() => mapSite(row, this.localSiteOrigin));
    },
  );

  private runClaimedOperationEffect<T>(
    userId: string,
    key: string,
    operation: string,
    resourceId: string,
    parseResponse: (value: string) => T,
    responseFor: (value: T) => unknown,
    run: () => Effect.Effect<T, HostedSiteFailure, HostedSiteStorage>,
  ): Effect.Effect<T, HostedSiteFailure, HostedSiteStorage> {
    return Effect.fn("HostedSites.runClaimedOperation")({ self: this }, function* () {
      const claim = yield* this.claimOperationEffect(userId, key, operation, resourceId);
      if (claim.status === "completed") return yield* siteDecode(() => parseResponse(claim.response));
      return yield* Effect.gen({ self: this }, function* () {
        const result = yield* run();
        yield* this.completeOperationEffect(userId, key, operation, resourceId, claim.token, responseFor(result));
        return result;
      }).pipe(Effect.tapCause(() => this.releaseOperationEffect(userId, key, operation, resourceId, claim.token)));
    })();
  }

  private readonly claimOperationEffect = Effect.fn("HostedSites.claimOperation")(
    { self: this },
    function* (
      userId: string,
      key: string,
      operation: string,
      resourceId: string,
    ): Effect.fn.Return<OperationClaim, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      const now = this.now();
      const token = crypto.randomUUID();
      const insert = yield* siteCall(() =>
        database
          .prepare(
            `INSERT INTO site_operation_receipts(
           user_id, idempotency_key, operation, resource_id, status, claim_token,
           response_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, ?)
         ON CONFLICT(user_id, idempotency_key) DO NOTHING`,
          )
          .bind(userId, key, operation, resourceId, token, now, now)
          .run(),
      );
      if (insert.meta.changes === 1) return { status: "pending", token };

      const row = yield* siteCall(() =>
        database
          .prepare(
            `SELECT operation, resource_id, status, claim_token, response_json, updated_at
         FROM site_operation_receipts WHERE user_id = ? AND idempotency_key = ?`,
          )
          .bind(userId, key)
          .first<{
            operation: string;
            resource_id: string | null;
            status: "pending" | "completed";
            claim_token: string | null;
            response_json: string | null;
            updated_at: number;
          }>(),
      );
      if (!row)
        return yield* Effect.fail(siteFailure(new Error("The operation claim disappeared after its insert conflict.")));
      if (row.operation !== operation || row.resource_id !== resourceId) {
        return yield* new HostedSiteInputError(
          409,
          "idempotency_conflict",
          "This idempotency key was already used for a different site operation.",
        );
      }
      if (row.status === "completed" && row.response_json !== null) {
        return { status: "completed", response: row.response_json };
      }

      const staleBefore = now - HOSTED_SITE_LIMITS.uploadLifetimeMs;
      if (row.status === "pending" && row.claim_token && row.updated_at <= staleBefore) {
        const stolen = yield* siteCall(() =>
          database
            .prepare(
              `UPDATE site_operation_receipts SET claim_token = ?, updated_at = ?
           WHERE user_id = ? AND idempotency_key = ? AND operation = ? AND resource_id = ?
             AND status = 'pending' AND claim_token = ? AND updated_at = ?`,
            )
            .bind(token, now, userId, key, operation, resourceId, row.claim_token, row.updated_at)
            .run(),
        );
        if (stolen.meta.changes === 1) return { status: "pending", token };
      }
      return yield* new HostedSiteInputError(
        409,
        "operation_in_progress",
        "This site operation is already in progress.",
      );
    },
  );

  private readonly completedDeletionEffect = Effect.fn("HostedSites.completedDeletion")(
    { self: this },
    function* (userId: string, siteId: string): Effect.fn.Return<boolean, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      const row = yield* siteCall(() =>
        database
          .prepare(
            `SELECT 1 AS completed FROM site_operation_receipts
         WHERE user_id = ? AND resource_id = ? AND operation = 'delete' AND status = 'completed' LIMIT 1`,
          )
          .bind(userId, siteId)
          .first<{ completed: number }>(),
      );
      return row?.completed === 1;
    },
  );

  private readonly completeOperationEffect = Effect.fn("HostedSites.completeOperation")(
    { self: this },
    function* (
      userId: string,
      key: string,
      operation: string,
      resourceId: string,
      token: string,
      response: unknown,
    ): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      const completed = yield* siteCall(() =>
        database
          .prepare(
            `UPDATE site_operation_receipts
         SET status = 'completed', claim_token = NULL, response_json = ?, updated_at = ?
         WHERE user_id = ? AND idempotency_key = ? AND operation = ? AND resource_id = ?
           AND status = 'pending' AND claim_token = ?`,
          )
          .bind(JSON.stringify(response), this.now(), userId, key, operation, resourceId, token)
          .run(),
      );
      if (completed.meta.changes !== 1)
        return yield* Effect.fail(siteFailure(new Error("The site operation claim could not be completed.")));
    },
  );

  private readonly releaseOperationEffect = Effect.fn("HostedSites.releaseOperation")(
    { self: this },
    function* (
      userId: string,
      key: string,
      operation: string,
      resourceId: string,
      token: string,
    ): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      yield* siteCall(() =>
        database
          .prepare(
            `DELETE FROM site_operation_receipts
         WHERE user_id = ? AND idempotency_key = ? AND operation = ? AND resource_id = ?
           AND status = 'pending' AND claim_token = ?`,
          )
          .bind(userId, key, operation, resourceId, token)
          .run(),
      );
    },
  );

  private readonly abandonExpiredUploadsEffect = Effect.fn("HostedSites.abandonExpiredUploads")(
    { self: this },
    function* (userId: string, now: number): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      const stale = yield* siteCall(() =>
        database
          .prepare(
            `SELECT id, site_id FROM site_deployments
         WHERE user_id = ? AND status IN ('uploading', 'activating') AND upload_expires_at <= ?`,
          )
          .bind(userId, now)
          .all<{ id: string; site_id: string }>(),
      );
      for (const upload of stale.results) {
        const claim = yield* siteCall(() =>
          database
            .prepare(
              `UPDATE site_deployments SET status = 'abandoned'
           WHERE id = ? AND user_id = ? AND status IN ('uploading', 'activating') AND upload_expires_at <= ?`,
            )
            .bind(upload.id, userId, now)
            .run(),
        );
        if (claim.meta.changes === 1) yield* this.deleteDeploymentEffect(upload.site_id, upload.id);
      }
      yield* siteCall(() =>
        database
          .prepare(
            `DELETE FROM hosted_sites
         WHERE user_id = ? AND status = 'uploading' AND current_deployment_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM site_deployments d
             WHERE d.site_id = hosted_sites.id AND d.status IN ('uploading', 'activating')
           )`,
          )
          .bind(userId)
          .run(),
      );
    },
  );

  private readonly deleteDeploymentEffect = Effect.fn("HostedSites.deleteDeployment")(
    { self: this },
    function* (siteId: string, deploymentId: string): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { bucket, database } = yield* HostedSiteStorage;

      let cursor: string | undefined;
      do {
        const listed = yield* siteCall(() =>
          bucket.list({ prefix: hostedSiteDeploymentPrefix(siteId, deploymentId), cursor }),
        );
        if (listed.objects.length) yield* siteCall(() => bucket.delete(listed.objects.map((object) => object.key)));
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      yield* siteCall(() =>
        database
          .prepare("UPDATE site_deployments SET objects_deleted_at = ? WHERE id = ? AND site_id = ?")
          .bind(this.now(), deploymentId, siteId)
          .run(),
      );
    },
  );

  private readonly deleteBlockMarkerEffect = Effect.fn("HostedSites.deleteBlockMarker")(
    { self: this },
    function* (siteId: string, hostname: string): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { bucket } = yield* HostedSiteStorage;

      yield* siteCall(() => bucket.delete(hostedSiteBlockKey(hostname))).pipe(
        Effect.tapError(() => this.markRouteUnsyncedEffect(siteId)),
      );
    },
  );

  private readonly putBlockMarkerForSyncedRouteEffect = Effect.fn("HostedSites.putBlockMarkerForSyncedRoute")(
    { self: this },
    function* (siteId: string, hostname: string): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { bucket } = yield* HostedSiteStorage;

      yield* siteCall(() =>
        bucket.put(hostedSiteBlockKey(hostname), "blocked", { httpMetadata: { contentType: "text/plain" } }),
      ).pipe(Effect.tapError(() => this.markRouteUnsyncedEffect(siteId)));
    },
  );

  private readonly markRouteUnsyncedEffect = Effect.fn("HostedSites.markRouteUnsynced")(
    { self: this },
    function* (siteId: string): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { database } = yield* HostedSiteStorage;

      yield* siteCall(() =>
        database.prepare("UPDATE hosted_sites SET route_synced_at = NULL WHERE id = ?").bind(siteId).run(),
      );
    },
  );

  private readonly reconcileRouteAndMarkerEffect = Effect.fn("HostedSites.reconcileRouteAndMarker")(
    { self: this },
    function* (siteId: string): Effect.fn.Return<void, HostedSiteFailure, HostedSiteStorage> {
      const { bucket } = yield* HostedSiteStorage;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const before = yield* this.siteByIdEffect(siteId);
        if (!before) return;
        if (before.status === "blocked") {
          yield* siteCall(() =>
            bucket.put(hostedSiteBlockKey(before.hostname), "blocked", {
              httpMetadata: { contentType: "text/plain" },
            }),
          );
        }
        yield* this.publishAuthoritativeRouteEffect(siteId);
        const published = yield* this.siteByIdEffect(siteId);
        if (!published) return;
        if (published.status === "blocked") {
          yield* this.putBlockMarkerForSyncedRouteEffect(published.id, published.hostname);
        } else {
          yield* this.deleteBlockMarkerEffect(published.id, published.hostname);
        }
        const after = yield* this.siteByIdEffect(siteId);
        if (after && siteRouteIdentity(after) === siteRouteIdentity(published)) return;
      }
      return yield* Effect.fail(
        siteFailure(new Error("The site state changed too often during route reconciliation.")),
      );
    },
  );

  private readonly recoverConcurrentUploadEffect = Effect.fn("HostedSites.recoverConcurrentUpload")(
    { self: this },
    function* (
      userId: string,
      idempotencyKey: string,
      requestHash: string,
      error: unknown,
    ): Effect.fn.Return<HostedSiteUploadSession, HostedSiteFailure, HostedSiteStorage> {
      const prior = yield* this.deploymentByIdempotencyEffect(userId, idempotencyKey);
      if (prior) return yield* this.uploadSessionForRequestEffect(prior, requestHash);
      return yield* Effect.fail(siteFailure(error));
    },
  );
}

/** A request changes only the sites of its own server, or unlinked sites when it proved no server. */
function requireSiteInBucket(site: SiteRow, serverId: string | null): void {
  if ((site.server_id ?? null) === serverId) return;
  throw new HostedSiteInputError(409, "site_other_server", "This site belongs to another server.");
}

function siteLimitError(serverId: string | null, limit: number): HostedSiteInputError {
  const owner = serverId === null ? "This account has no server, and it" : "This server";
  const sites = limit === 1 ? "1 active site" : `${limit} active sites`;
  return new HostedSiteInputError(409, "site_limit", `${owner} is at its limit of ${sites}.`);
}
