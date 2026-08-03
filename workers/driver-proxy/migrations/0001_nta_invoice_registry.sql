-- NTA invoice registry cache (24h TTL) and lookup audit / rate-limit helpers.
-- Application ID must never be stored in these tables.

CREATE TABLE IF NOT EXISTS nta_invoice_registry_cache (
  cache_key TEXT PRIMARY KEY,
  registration_number TEXT NOT NULL,
  basis_date TEXT,
  api_type TEXT NOT NULL,
  status TEXT NOT NULL,
  response_json TEXT NOT NULL,
  nta_last_update_date TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nta_invoice_registry_cache_expires_at
ON nta_invoice_registry_cache(expires_at);

CREATE TABLE IF NOT EXISTS nta_invoice_lookup_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  basis_date TEXT,
  result_status TEXT NOT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  nta_last_update_date TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nta_invoice_lookup_audit_tenant_created
ON nta_invoice_lookup_audit(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nta_invoice_rate_limit (
  bucket_key TEXT PRIMARY KEY,
  hit_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
