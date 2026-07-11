CREATE TABLE IF NOT EXISTS deals (
  id BIGINT PRIMARY KEY,
  buyer TEXT NOT NULL,
  seller TEXT NOT NULL,
  token TEXT NOT NULL,
  arbiter TEXT,
  arbiter_fee_bps INT NOT NULL DEFAULT 0,
  title TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS milestones (
  deal_id BIGINT NOT NULL REFERENCES deals(id),
  idx INT NOT NULL,
  amount NUMERIC(30, 0) NOT NULL,
  desc_hash TEXT NOT NULL,
  deadline TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'Pending',
  tx_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, idx)
);

CREATE TABLE IF NOT EXISTS disputes (
  deal_id BIGINT NOT NULL REFERENCES deals(id),
  idx INT NOT NULL,
  raised_by TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  buyer_bps INT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, idx)
);

-- Aggregates the indexer keeps up to date so the frontend can show arbiter
-- track records (resolution speed, split tendencies) next to each listing.
CREATE TABLE IF NOT EXISTS arbiter_stats (
  arbiter TEXT PRIMARY KEY,
  disputes_resolved INT NOT NULL DEFAULT 0,
  avg_resolution_secs BIGINT,
  avg_buyer_bps INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Share links: safehand.app/d/<code> resolves to a deal. Metadata lives
-- off-chain here; the contract only stores hashes.
CREATE TABLE IF NOT EXISTS deal_links (
  code TEXT PRIMARY KEY,
  deal_id BIGINT NOT NULL REFERENCES deals(id),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cursor for the event indexer: last ledger sequence processed.
CREATE TABLE IF NOT EXISTS indexer_state (
  id INT PRIMARY KEY DEFAULT 1,
  last_ledger BIGINT NOT NULL DEFAULT 0
);
INSERT INTO indexer_state (id, last_ledger) VALUES (1, 0) ON CONFLICT DO NOTHING;
