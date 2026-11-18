import type { OpenBotMigration } from "./migration";

// Shared by migration v63 and the separate new-database schema. IF NOT EXISTS, because this text is
// both the migration and the tail of the latest schema. The INSERT OR IGNORE of the built-in
// statuses is in the same text, so both paths have them once.
//
// The CRM of this computer or server: the statuses, tags and customers, the plans that the customers
// bought, their payments, what happened to each customer, and the changes that agents propose. An
// owner or admin writes it directly; an agent only adds a pending proposal. Configuration and records
// that a person keeps, written directly, so there is no event and no projection.
//
// - `crm_counters` gives the customer and invoice numbers. Each number is the counter + 1 and the
//   counter never goes down, so a deleted customer or payment never gives its number again.
// - `crm_customers.search_text` is a JSON object of the normalized text fields (lower case, no
//   accents). A search reads only the fields it may read, so an agent never matches a private value.
// - Amounts are whole minor units of the customer's ISO 4217 currency. Times are ISO 8601 text, due
//   dates and plan dates are `YYYY-MM-DD`.
// - A deleted customer deletes its tags, plans, payments, activity and proposals. A deleted plan keeps
//   its payments (paid ones are history); they lose the plan. A built-in status has no label: the
//   client shows its catalog name. The application refuses to rename or delete one.
// - `crm_sources` holds a connected payment source (Stripe). Its key is not here: the host keeps it
//   encrypted in its user data folder. A customer, plan or payment that a source made or linked has
//   its `source_ref` (such as `stripe:in_…`); `source_id` is set while the source is connected, and a
//   row with it is read-only for people and agents. A disconnect sets `source_id` to NULL and keeps
//   `source_ref`, so a new connect links the same rows again. `crm_source_ignored` holds the refs of
//   linked customers that a person deleted, so a sync does not import them again.
export const CRM_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS crm_counters (
    name TEXT NOT NULL PRIMARY KEY CHECK(name IN ('customer', 'payment')),
    value INTEGER NOT NULL CHECK(value >= 0)
  );
  CREATE TABLE IF NOT EXISTS crm_statuses (
    status_id TEXT NOT NULL PRIMARY KEY
      CHECK(length(status_id) = 32 OR status_id IN ('lead', 'customer', 'former')),
    label TEXT COLLATE NOCASE UNIQUE CHECK(label IS NULL OR length(label) BETWEEN 1 AND 80),
    tone TEXT NOT NULL
      CHECK(tone IN ('info-light', 'secondary', 'outline', 'warning-light', 'success-light', 'primary-light')),
    position INTEGER NOT NULL CHECK(position >= 0),
    created_at TEXT NOT NULL,
    CHECK((status_id IN ('lead', 'customer', 'former')) = (label IS NULL))
  );
  INSERT OR IGNORE INTO crm_statuses (status_id, label, tone, position, created_at) VALUES
    ('lead', NULL, 'info-light', 0, '1970-01-01T00:00:00.000Z'),
    ('customer', NULL, 'secondary', 1, '1970-01-01T00:00:00.000Z'),
    ('former', NULL, 'outline', 2, '1970-01-01T00:00:00.000Z');
  CREATE TABLE IF NOT EXISTS crm_sources (
    source_id TEXT NOT NULL PRIMARY KEY CHECK(length(source_id) = 32),
    kind TEXT NOT NULL UNIQUE CHECK(kind IN ('stripe')),
    test_mode INTEGER NOT NULL CHECK(test_mode IN (0, 1)),
    account_label TEXT NOT NULL DEFAULT '' CHECK(length(account_label) <= 200),
    key_hint TEXT NOT NULL CHECK(length(key_hint) <= 8),
    state TEXT NOT NULL CHECK(state IN ('syncing', 'ok', 'error')),
    error_code TEXT CHECK(error_code IS NULL OR error_code IN ('invalid-key', 'permission', 'rate-limited',
      'network', 'stripe')),
    synced_at TEXT,
    skipped_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(skipped_json)),
    connected_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS crm_source_ignored (
    source_ref TEXT NOT NULL PRIMARY KEY CHECK(length(source_ref) BETWEEN 1 AND 255)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS crm_customers (
    customer_id TEXT NOT NULL PRIMARY KEY CHECK(length(customer_id) = 32),
    number INTEGER NOT NULL UNIQUE CHECK(number >= 1),
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
    status_id TEXT NOT NULL REFERENCES crm_statuses(status_id),
    owner_agent_id TEXT CHECK(owner_agent_id IS NULL OR length(owner_agent_id) BETWEEN 1 AND 255),
    method TEXT CHECK(method IS NULL OR method IN ('stripe', 'transfer', 'crypto', 'paypal', 'cash')),
    currency TEXT NOT NULL CHECK(length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
    contact_name TEXT NOT NULL DEFAULT '' CHECK(length(contact_name) <= 500),
    contact_email TEXT NOT NULL DEFAULT '' CHECK(length(contact_email) <= 500),
    phone TEXT NOT NULL DEFAULT '' CHECK(length(phone) <= 500),
    billing_email TEXT NOT NULL DEFAULT '' CHECK(length(billing_email) <= 500),
    domain TEXT NOT NULL DEFAULT '' CHECK(length(domain) <= 500),
    tax_id TEXT NOT NULL DEFAULT '' CHECK(length(tax_id) <= 500),
    address TEXT NOT NULL DEFAULT '' CHECK(length(address) <= 500),
    stripe_customer_id TEXT NOT NULL DEFAULT '' CHECK(length(stripe_customer_id) <= 500),
    notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 4000),
    search_text TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(search_text)),
    source_id TEXT REFERENCES crm_sources(source_id) ON DELETE SET NULL,
    source_ref TEXT CHECK(source_ref IS NULL OR length(source_ref) BETWEEN 1 AND 255),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)
  );
  CREATE INDEX IF NOT EXISTS crm_customers_status ON crm_customers(status_id);
  CREATE INDEX IF NOT EXISTS crm_customers_stripe ON crm_customers(stripe_customer_id) WHERE stripe_customer_id <> '';
  CREATE UNIQUE INDEX IF NOT EXISTS crm_customers_source ON crm_customers(source_ref) WHERE source_ref IS NOT NULL;
  CREATE TABLE IF NOT EXISTS crm_tags (
    tag_id TEXT NOT NULL PRIMARY KEY CHECK(length(tag_id) = 32),
    label TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(label) BETWEEN 1 AND 40),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS crm_customer_tags (
    customer_id TEXT NOT NULL REFERENCES crm_customers(customer_id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES crm_tags(tag_id) ON DELETE CASCADE,
    PRIMARY KEY (customer_id, tag_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS crm_customer_tags_tag ON crm_customer_tags(tag_id);
  CREATE TABLE IF NOT EXISTS crm_plans (
    plan_id TEXT NOT NULL PRIMARY KEY CHECK(length(plan_id) = 32),
    customer_id TEXT NOT NULL REFERENCES crm_customers(customer_id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
    amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 0 AND 1000000000000),
    every TEXT NOT NULL CHECK(every IN ('month', 'quarter', 'year', 'once')),
    starts_on TEXT NOT NULL CHECK(starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    ends_on TEXT CHECK(ends_on IS NULL OR (ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND ends_on >= starts_on)),
    source_id TEXT REFERENCES crm_sources(source_id) ON DELETE SET NULL,
    source_ref TEXT CHECK(source_ref IS NULL OR length(source_ref) BETWEEN 1 AND 255),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS crm_plans_customer ON crm_plans(customer_id);
  CREATE UNIQUE INDEX IF NOT EXISTS crm_plans_source ON crm_plans(source_ref) WHERE source_ref IS NOT NULL;
  CREATE TABLE IF NOT EXISTS crm_payments (
    payment_id TEXT NOT NULL PRIMARY KEY CHECK(length(payment_id) = 32),
    number INTEGER NOT NULL UNIQUE CHECK(number >= 1),
    customer_id TEXT NOT NULL REFERENCES crm_customers(customer_id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES crm_plans(plan_id) ON DELETE SET NULL,
    label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
    amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 0 AND 1000000000000),
    due_on TEXT NOT NULL CHECK(due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    paid_at TEXT CHECK(paid_at IS NULL OR length(paid_at) BETWEEN 1 AND 64),
    method TEXT CHECK(method IS NULL OR method IN ('stripe', 'transfer', 'crypto', 'paypal', 'cash')),
    source_id TEXT REFERENCES crm_sources(source_id) ON DELETE SET NULL,
    source_ref TEXT CHECK(source_ref IS NULL OR length(source_ref) BETWEEN 1 AND 255),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS crm_payments_source ON crm_payments(source_ref) WHERE source_ref IS NOT NULL;
  CREATE INDEX IF NOT EXISTS crm_payments_open ON crm_payments(due_on, number) WHERE paid_at IS NULL;
  CREATE INDEX IF NOT EXISTS crm_payments_paid ON crm_payments(paid_at, number) WHERE paid_at IS NOT NULL;
  CREATE INDEX IF NOT EXISTS crm_payments_customer ON crm_payments(customer_id, due_on);
  CREATE INDEX IF NOT EXISTS crm_payments_plan ON crm_payments(plan_id) WHERE plan_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS crm_activity (
    activity_id TEXT NOT NULL PRIMARY KEY CHECK(length(activity_id) = 32),
    customer_id TEXT NOT NULL REFERENCES crm_customers(customer_id) ON DELETE CASCADE,
    actor_kind TEXT NOT NULL CHECK(actor_kind IN ('person', 'agent', 'source')),
    actor_id TEXT CHECK(actor_id IS NULL OR length(actor_id) BETWEEN 1 AND 255),
    actor_name TEXT CHECK(actor_name IS NULL OR length(actor_name) <= 200),
    kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 48),
    details_json TEXT NOT NULL CHECK(json_valid(details_json)),
    proposed_by TEXT CHECK(proposed_by IS NULL OR length(proposed_by) BETWEEN 1 AND 255),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS crm_activity_customer ON crm_activity(customer_id, created_at DESC, activity_id DESC);
  CREATE TABLE IF NOT EXISTS crm_proposals (
    proposal_id TEXT NOT NULL PRIMARY KEY CHECK(length(proposal_id) = 32),
    agent_id TEXT NOT NULL CHECK(length(agent_id) BETWEEN 1 AND 255),
    customer_id TEXT REFERENCES crm_customers(customer_id) ON DELETE CASCADE,
    thread_id TEXT CHECK(thread_id IS NULL OR length(thread_id) BETWEEN 1 AND 255),
    reason TEXT NOT NULL CHECK(length(reason) <= 1000),
    change_json TEXT NOT NULL CHECK(json_valid(change_json)),
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by_id TEXT,
    decided_by_name TEXT,
    CHECK((state = 'pending') = (decided_at IS NULL))
  );
  CREATE INDEX IF NOT EXISTS crm_proposals_pending ON crm_proposals(created_at DESC, proposal_id DESC)
    WHERE state = 'pending';
  CREATE INDEX IF NOT EXISTS crm_proposals_agent ON crm_proposals(agent_id) WHERE state = 'pending';
  CREATE INDEX IF NOT EXISTS crm_proposals_customer ON crm_proposals(customer_id) WHERE customer_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS crm_private_fields (
    field TEXT NOT NULL PRIMARY KEY CHECK(field IN ('name', 'contactName', 'contactEmail', 'phone',
      'billingEmail', 'domain', 'taxId', 'address', 'stripeCustomerId', 'notes', 'amounts', 'dates', 'status',
      'tags', 'plans', 'method', 'owner'))
  );
  CREATE TABLE IF NOT EXISTS crm_agent_access (
    agent_id TEXT NOT NULL PRIMARY KEY CHECK(length(agent_id) BETWEEN 1 AND 255),
    granted_at TEXT NOT NULL
  );
`;

export const migration: OpenBotMigration = {
  version: 63,
  name: "crm",
  // Only creates tables and their indexes, and adds the three built-in statuses, so no foreign-key
  // pause and no vacuum. No CRM data was saved before it, so the other tables start empty.
  up: (db) => db.exec(CRM_SCHEMA_SQL),
};
