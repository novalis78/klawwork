-- Migration 002: Add worker skills + rate limiting
-- Run against both staging and production D1 databases

-- Worker skills (many-to-many)
CREATE TABLE IF NOT EXISTS worker_skills (
  user_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  verified BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, skill),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_worker_skills_skill ON worker_skills(skill);
CREATE INDEX IF NOT EXISTS idx_worker_skills_user ON worker_skills(user_id);

-- Add skills as comma-separated cache on users for quick filtering
ALTER TABLE users ADD COLUMN skills TEXT;

-- Add availability flag
ALTER TABLE users ADD COLUMN available BOOLEAN DEFAULT 1;

-- Rate limiting table (sliding window per key)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (key, window)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
