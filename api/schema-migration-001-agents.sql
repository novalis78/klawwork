-- Migration 001: Add agent support
-- Run against both staging and production D1 databases

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  callback_url TEXT,
  jobs_created INTEGER DEFAULT 0,
  jobs_completed INTEGER DEFAULT 0,
  total_spent_sats REAL DEFAULT 0.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add escrow and rejection tracking to jobs
ALTER TABLE jobs ADD COLUMN escrow_hold_id TEXT;
ALTER TABLE jobs ADD COLUMN rejection_count INTEGER DEFAULT 0;
ALTER TABLE jobs ADD COLUMN last_rejection_reason TEXT;
