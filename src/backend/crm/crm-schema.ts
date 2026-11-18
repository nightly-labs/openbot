/** The CRM tables right after migration 63, for the migration tests of earlier versions. */
export const CRM_TABLES_AFTER_MIGRATION: Record<string, Record<string, string | number | null>[]> = {
  crm_activity: [],
  crm_agent_access: [],
  crm_counters: [],
  crm_customer_tags: [],
  crm_customers: [],
  crm_payments: [],
  crm_plans: [],
  crm_private_fields: [],
  crm_proposals: [],
  crm_source_ignored: [],
  crm_sources: [],
  crm_statuses: [
    { status_id: "lead", label: null, tone: "info-light", position: 0, created_at: "1970-01-01T00:00:00.000Z" },
    { status_id: "customer", label: null, tone: "secondary", position: 1, created_at: "1970-01-01T00:00:00.000Z" },
    { status_id: "former", label: null, tone: "outline", position: 2, created_at: "1970-01-01T00:00:00.000Z" },
  ],
  crm_tags: [],
};
