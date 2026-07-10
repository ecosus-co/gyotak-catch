-- v3: GPS nonce table for persistentCommit hiding commitment.
-- PRIMARY KEY on batch_id ensures a nonce can never be overwritten:
-- a second INSERT for the same batch_id fails with UNIQUE constraint.
-- This is intentional — once a nonce is written, it must never change,
-- because the on-chain gpsCommitment is bound to it.

CREATE TABLE IF NOT EXISTS catch_gps_nonces (
  batch_id   TEXT PRIMARY KEY,
  gps_nonce  TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
