# Plan 012: A pool server whose plan ended goes to an archive, and its machine goes back to the pool

> **Executor instructions**: Each item below is one PR. Read the whole plan, run the drift check, and
> respect the `STOP` conditions. Read `apps/auth-api/AGENTS.md` before an item that changes the Worker
> or D1, and the [Leaseweb servers](../AGENTS.md#leaseweb-servers) rules before an item that touches a
> machine.
>
> **Drift check (run first)**: `git diff --stat 5fd3a12b9a..HEAD -- apps/auth-api/src/server/hosted-server-service.ts
> scripts/hosting docs/hosted-servers.md`. If a file changed, compare the "Evidence" lines with the
> live code. On a mismatch, STOP.

## Status

- **Priority**: P2
- **Size**: L
- **Planned at**: commit `5fd3a12b9a` (2026-11-19); updated at `39a0642862` for #12721 (new Terms:
  14 days of data, a cancelled and refunded server is deleted at once)
- **State**: IN PROGRESS (items 1 and 2 done; items 3, 5 and 6 written, not applied)

## Why this matters

- A pool machine keeps the data of an ended plan for 14 days (`OPERATOR_HOST_DATA_KEPT_MS` in
  `hosted-server-service.ts`). For these 14 days the machine cannot take a new customer, and the
  operator pays for it.
- The Terms promise 14 days of data after the plan ends (`apps/auth-api/src/content/terms.tsx`).
  An encrypted archive in Backblaze B2 keeps that promise at about USD 6 per TB and month, and the
  machine goes back to the pool at once.

## Decisions (developer, 2026-11-19)

1. **Pool machines only.** boat servers do not change: boat deletes a stopped disk after 14 days, which
   is now the same as the Terms (#12721).
2. **When to archive.** "Ends" is the Stripe state `canceled` or `incomplete_expired`, read fresh at
   Stripe (as `BillingService.subscriptionEnded` does). A failed payment must not cause an archive
   while Stripe still tries to collect it (see [Failed payments](#failed-payments)).
   - The owner cancelled (reason `canceled`: a cancel, or a dispute of a plan 30 days or older):
     archive at once, and keep the archive 14 days.
   - Cancelled and refunded, in either order, or a dispute in the first 30 days of the subscription
     (`DISPUTE_DELETES_SERVER_MS`): no archive. Since #12721 the webhook deletes the server
     at once (`HostedServerService.deleteForRefund`), as the Terms say. `sync` then reinstalls the
     machine, and item 5 deletes an archive that was made before the refund.
   - The payment failed (reason `unpaid`): wait 3 days first (`POOL_UNPAID_ARCHIVE_AFTER_MS`). An owner
     who fixes the card and renews in this time gets the server back on the same machine, with no
     restore.
3. **Automatic restore.** When the owner renews, a free pool machine restores the archive by itself.
   The Worker keeps the archive key, wrapped with a Worker secret, in D1. Cloudflare holds the key but
   not the data; B2 holds the data but not the key.
4. **One B2 bucket.** All archives go to `openbot-pool-archive-eu` (B2 EU Central), also from
   `WDC-02` machines (developer, 2026-11-19; replaces "archive in the region of the machine"). The
   `region` column stays, so a second bucket can come later.
6. **Encryption.** `age` on the machine, with a new X25519 key for each archive (developer,
   2026-11-19).
5. **Restore target.** A ready pool machine with the product of the plan, in the locations of the
   currency (`poolLocations`), as for a new payment. When no machine is ready, the server restores into
   a new boat sandbox, and an operator moves it to a VPS later with the existing move
   ([Move a server from boat](../docs/hosted-servers.md#move-a-server-from-boat)). This is the same
   rule as for a new server today.

## Failed payments

| Case | Stripe state | Server | Archive |
| --- | --- | --- | --- |
| A renewal payment fails, Stripe retries | `past_due` | Runs (period end moves forward) | No |
| Stripe stops the retries | `canceled` | Stops (`plan_ended`) | 3 days later |
| The owner cancels the renewal | open until the period end, then `canceled` | Runs until the end, then stops | At once, at the end |
| A dispute in the first 30 days of the subscription | `canceled`; the server is deleted (`deleteForRefund`) | Deleted | Never; an earlier archive is deleted |
| A dispute of a plan 30 days or older | `canceled` (the webhook cancels it) | Stops, keeps its disk | At once, kept 14 days |
| Cancelled and refunded, in either order | `canceled`; the server is deleted (`deleteForRefund`) | Deleted | Never; an earlier archive is deleted |
| The owner renews while the archive runs | new subscription | The archive job sees `desired_state = 'running'`, stops, deletes the partial upload, keeps the machine and starts OpenBot | No |
| The owner renews after the archive | new subscription | Restore on a free machine | Read, then deleted after a restore that signed in |
| An `unpaid`, `past_due` or `paused` plan that Stripe keeps open | open | As today: stays on the machine with no limit, the operator decides | No |

A subscription that Stripe has `canceled` cannot become open again: a renewal is always a new
subscription. So an archive never races a late payment of the same subscription.

## Rules for each item

- Never reinstall a machine before the archive is verified: the object exists in B2, its size and its
  SHA-256 match what the machine sent, and D1 has the row with the wrapped key. Any failure keeps the
  data on the machine, and the next run tries again. The 14-day delete of today stays as the last
  fallback.
- The machine never gets a B2 key. `sync` makes the `age` key, starts a multipart upload with the
  operator key, and gives the machine only the recipient and a presigned URL for each part. The
  machine encrypts the archive and uploads it straight to B2, so the data never goes through the
  operator's computer (a 5 GB server would be 10 GB on that connection). `sync` checks the MD5 of each
  part, completes the upload and checks the size. A restore downloads with a presigned URL for one
  object that expires in 1 hour, signed by the Worker with its read-only key. (A key for each job needs
  the B2 master key. The account also holds another project's bucket, so a new master key is not an
  option: it would replace that project's key.)
- The archive holds the account session, provider sign-ins and keys of the customer
  (`move-from-boat.sh` header). Encrypt it on the machine before it leaves. Log no key, URL signature
  or token (Non-negotiable: redact secrets).
- Delete the archive 14 days after the plan ended, when the server is deleted (owner delete or
  refund), and when the account is deleted. A B2 lifecycle rule (hide after 15 days, delete 1 day
  later) is the backstop.
- No Team API change: clients still see an ended server, and a restore shows as a start.

## B2 setup (done 2026-11-19)

| Region | Bucket | Endpoint | Keys in `apps/auth-api/.env.production` |
| --- | --- | --- | --- |
| EU Central (`AMS-01`) | `openbot-pool-archive-eu`, private, SSE-B2, lifecycle: hide after 15 days, delete 1 day later (was 31; changed 2026-11-19 for the new Terms) | `s3.eu-central-003.backblazeb2.com` | `B2_KEY_ID_EU`, `B2_APPLICATION_KEY_EU` (operator: read, write, delete); `B2_WORKER_KEY_ID_EU`, `B2_WORKER_APPLICATION_KEY_EU` (Worker: read, share) |
| US East | Not made: the developer decided on 2026-11-19 to use the EU bucket for `WDC-02` too. | — | — |

Both keys reach only this bucket (checked with `b2_authorize_account`). Item 2 puts the Worker keys
in the GitHub `cloudflare-production` Environment, and the deploy makes them Worker secrets.

## Items

### 1. `export` and `import` on a pool machine

- **Evidence**: no pool mode is needed. `move-from-boat.sh` `export` and `import` already work on a
  pool machine: the boat image checks pass, and a VPS gives the service user no sudo, so customer data
  is only the home, the keyring and the crontab.
- **Fixed**: `export` copied the raw cron spool file with its "DO NOT EDIT" header, and `crontab` on
  the VPS kept those lines as customer text. It now uses `crontab -l`. Boat moves had the same bug.
  `leaseweb-pool.ts` packs the hosting folder with `--no-xattrs` (macOS tar added headers that GNU tar
  warned about).
- **Done (2026-11-19)**: `scripts/hosting/pool-archive-e2e.ts` on `pool-test-01` (12727743, DE):
  prepare, seed, export, reinstall, import, start. 6 of 6 checks pass: same archive sha256, 446 facts
  (file sha256, type, mode, owner, link, crontab) with none missing or added, OpenBot runs after the
  import. Archive 116 MB; export 56 s, upload and import 39 s, reinstall and prepare 202 s. Report:
  `.openbot-build/pool-archive-e2e.json`.
- **Timing (2026-11-19, `--extra-gb=5`)**: 5.75 GB server, 5.80 GB archive in 56 parts, 9 of 9 checks
  pass (54,094 facts). Export, encrypt and upload 661 s (8.8 MB/s, one part at a time); download and
  decrypt 269 s; import 349 s, of which `tar --extract` is 347 s; reinstall and prepare 312 s. The
  same extract alone took 47 to 67 s, so the disk speed of the VPS changes, not the import.
- **Item 1b (open)**: sandbox mode of `import` for the boat restore (decision 5), and an E2E that
  imports the same archive into a test boat sandbox.
- **STOP** when a pool machine has data that neither list covers.

### 2. D1 table and Worker keys

- **Done (2026-11-19)**: migration `0061_hosted_server_archives.sql` (#12845 has 0060). One row for
  each archive, keyed by `object_key`: `server_id`, `region`, `bucket`, `version_id` (a B2 delete
  needs it), `size_bytes`, `sha256`, `wrapped_key`, `plan_ended_at`, `delete_after`, `created_at`,
  `restored_at`, `deleted_at`. `sync` writes the row only after the checks, so there is no
  `verified_at`. The table has no foreign key: the archive must stay findable after a server or
  account delete, so that the B2 object is deleted too. A deleted archive has no key (a `CHECK`).
- **Not done, on purpose**: `hosted_servers.plan_end_reason`. Stripe keeps the reason on the
  subscription (`cancellation_details.reason` is `payment_failed` after the last retry), and `sync`
  reads the subscription fresh in item 3.
- **Secrets**: `HOSTED_ARCHIVE_KEY_SECRET` (32 random bytes, encrypts the `age` key in
  `wrapped_key`), `B2_WORKER_KEY_ID_EU`, `B2_WORKER_APPLICATION_KEY_EU`. They are in
  `.env.production` and in the GitHub `cloudflare-production` Environment; `deploy-auth-api.ts` and
  `ci.yml` send them as a set of three. The Stripe "If all retries fail" setting is "cancel the
  subscription" (developer, 2026-11-19).
- **Open for item 5**: the Worker B2 key can read and share but not delete. Either `sync` deletes
  the due archives each day, or the Worker gets a key that can also delete.
- **Check**: the D1 migration rules of `apps/auth-api/AGENTS.md`;
  `apps/auth-api/test/hosted-server-archives-migration.test.ts`.

### 3. Archive job in `leaseweb-pool.ts sync`

- **Evidence**: `sync` already stops OpenBot after a plan ends and reinstalls a machine after a delete
  (`docs/hosted-servers.md` "Reuse a pool machine").
- **Change**: for a stopped row with an ended plan (fresh Stripe read) and no verified archive: run
  `export - | age -r <recipient> | split --filter=<upload part>` on the machine over SSH, with
  presigned part URLs (see the rules), verify, store the row, then reinstall the machine and set
  `operator_host = NULL`. The server row stays with `desired_state = 'stopped'`.
  `scripts/hosting/pool-archive-e2e.ts` has the tested shell and SigV4 code. `leaseweb-bootstrap.sh`
  installs `age`; a machine prepared before that needs `apt-get install age` first.
- **Timing**: archive a `canceled` end at once and an `unpaid` end 3 days after `plan_ended_at`
  (decision 2). The operator runs `sync` once a day, so "at once" means "at the next `sync`". The
  developer decided on 2026-11-19 that the daily `sync` is enough: no timer.
- **STOP** before the first `--apply` on a production machine: the developer approves it.
- **Written (2026-11-19, branch `t3/pool-archive-job`)**: `scripts/hosting/pool-archive.ts` holds the
  B2, `age` and key-wrap code that the E2E and `sync` share. `sync` archives, writes the row only while
  the server is still stopped, then frees and reinstalls the machine. The Worker 14-day delete now also
  finds a server with a live archive and no machine, and deletes the old boat sandbox of a moved server
  (`retired_sandbox_id`) when the server has no machine.
- **Found**: the Worker `#renew` gives a server with no machine and no sandbox a new, empty server. So
  the first production `--apply` waits until item 4 is live. On 2026-11-19 production had two servers
  that `sync` would archive (both `canceled`).

### 4. Restore through the pool assignment

- **Evidence**: `POST /v2/hosting/pool/assignment` answers `{"state":"assigned","serverId","claim"}`
  (`docs/hosted-servers.md:1158`).
- **Change**: a renewal of an archived server takes a ready machine as a payment does, and the answer
  gets a `restore` part: a presigned URL, the unwrapped key and the checksum. `openbot-pool-wait`
  downloads, decrypts, checks, runs `import`, then starts OpenBot. A machine that does not send a new
  `restoreVersion` field gets no restore assignment.
- **No ready machine** (decision 5): the Worker makes a boat sandbox as for a new server, and its
  setup script downloads, decrypts and imports the archive before OpenBot starts. This needs a
  sandbox mode of `import` (item 1b). The Worker sends one alert to
  `HOSTED_POOL_ALERT_WEBHOOK_URL`, so the operator can move the server to a VPS later.
- **Not confirmed**: that an archive from a pool machine imports into the boat image: agent CLIs and
  packages can differ. Test it in item 1b.

### 5. Delete paths

- **Change**: the 14-day cron deletes the archive and the row; the owner delete, the refund delete
  (`deleteForRefund`) and the account delete delete the archive at once.
- **Decided (default, 2026-11-19)**: `sync` deletes, not the Worker, so the Worker key stays
  read-only. Each `sync` deletes an archive whose `delete_after` is past, whose server is deleted, or
  that a restore used (`restored_at`). "At once" is "at the next daily `sync`"; the B2 lifecycle is the
  backstop. Written in item 3's branch.

### 6. Documents

- `docs/hosted-servers.md` (Reuse a pool machine, operator table), `PRIVACY.md` (the archive, B2 as a
  processor, the regions), `apps/auth-api/src/content/dpa.tsx` (Backblaze as a sub-processor). The
  developer approves the legal text.
- `changelog.d/<branch>.md` for each PR.
- **Written (2026-11-19)** on `t3/pool-archive-job`: `PRIVACY.md` (archive paragraph; also `pool-free`
  to `pool`), `dpa.tsx` § 9 (Backblaze, Inc.), `docs/hosted-servers.md` "Archive of an ended pool
  server". Not changed: the DPA § 11 says 30 days of retention and names no Leaseweb; PRIVACY says
  14 days and names Leaseweb.

## Surfaces

Account service Worker and D1, operator scripts and pool machines, documents. No desktop, mobile,
web client or Team API change.

## Not confirmed

- That `export` works on a pool machine with small changes: only the script header and its checks were
  read.
- The archive size of a real server.
