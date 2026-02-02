-- KeyWorker Database Schema for Cloudflare D1

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT,
  phone TEXT,
  phone_verified BOOLEAN DEFAULT 0,
  email_verified BOOLEAN DEFAULT 0,

  -- Trust level: basic, verified, kyc_gold
  trust_level TEXT DEFAULT 'basic',

  -- Profile
  profile_image_url TEXT,
  bio TEXT,
  location TEXT,
  latitude REAL,
  longitude REAL,

  -- KeyKeeper integration
  keykeeper_address TEXT UNIQUE,
  keykeeper_verified BOOLEAN DEFAULT 0,

  -- Stats
  jobs_completed INTEGER DEFAULT 0,
  total_earned REAL DEFAULT 0.0,
  rating REAL DEFAULT 0.0,
  rating_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_keykeeper ON users(keykeeper_address);
CREATE INDEX idx_users_location ON users(latitude, longitude);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,  -- AI agent that created the job

  -- Job details
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,  -- photo_survey, verification, transcription, etc.

  -- Location
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  address TEXT,
  radius_meters INTEGER DEFAULT 100,

  -- Requirements
  required_trust_level TEXT DEFAULT 'basic',
  required_deliverables TEXT,  -- JSON array of required photos/videos
  estimated_duration_minutes INTEGER,

  -- Payment
  payment_amount REAL NOT NULL,
  payment_currency TEXT DEFAULT 'USD',
  payment_crypto_amount REAL,
  payment_crypto_currency TEXT,

  -- Status: available, assigned, in_progress, submitted, completed, cancelled
  status TEXT DEFAULT 'available',

  -- Assignment
  worker_id TEXT,
  assigned_at DATETIME,
  started_at DATETIME,
  submitted_at DATETIME,
  completed_at DATETIME,

  -- Deadlines
  expires_at DATETIME,
  must_complete_by DATETIME,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (worker_id) REFERENCES users(id)
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_location ON jobs(latitude, longitude);
CREATE INDEX idx_jobs_worker ON jobs(worker_id);
CREATE INDEX idx_jobs_agent ON jobs(agent_id);
CREATE INDEX idx_jobs_created ON jobs(created_at);

-- Job deliverables (photos/videos uploaded by workers)
CREATE TABLE IF NOT EXISTS job_deliverables (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,

  -- File details
  file_type TEXT NOT NULL,  -- photo, video, audio, document
  file_url TEXT NOT NULL,  -- R2 storage URL
  file_size INTEGER,
  mime_type TEXT,

  -- Metadata
  caption TEXT,
  latitude REAL,
  longitude REAL,
  timestamp DATETIME,

  -- Verification
  verified BOOLEAN DEFAULT 0,
  verification_notes TEXT,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (worker_id) REFERENCES users(id)
);

CREATE INDEX idx_deliverables_job ON job_deliverables(job_id);
CREATE INDEX idx_deliverables_worker ON job_deliverables(worker_id);

-- Wallet/transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Transaction type: job_payment, withdrawal, bonus, refund
  type TEXT NOT NULL,

  -- Amount
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',

  -- Related job
  job_id TEXT,

  -- Status: pending, completed, failed, cancelled
  status TEXT DEFAULT 'pending',

  -- Payment details
  payment_method TEXT,  -- crypto, bank_transfer, etc.
  payment_address TEXT,
  transaction_hash TEXT,  -- For crypto transactions

  -- Description
  description TEXT,
  notes TEXT,
  metadata TEXT,  -- JSON metadata (e.g., withdrawal destination)

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,

  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_job ON transactions(job_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created ON transactions(created_at);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,

  -- Participants
  agent_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,  -- worker, agent

  -- Message content
  message TEXT,
  message_type TEXT DEFAULT 'text',  -- text, photo, system
  attachment_url TEXT,

  -- Status
  is_read BOOLEAN DEFAULT 0,
  read_at DATETIME,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (worker_id) REFERENCES users(id)
);

CREATE INDEX idx_messages_job ON messages(job_id);
CREATE INDEX idx_messages_worker ON messages(worker_id);
CREATE INDEX idx_messages_agent ON messages(agent_id);
CREATE INDEX idx_messages_created ON messages(created_at);

-- Verification documents
CREATE TABLE IF NOT EXISTS verification_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Document type: government_id, selfie, proof_of_address, kyc_gold
  document_type TEXT NOT NULL,

  -- File storage
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  file_hash TEXT,  -- For integrity verification

  -- Verification status: pending, approved, rejected
  status TEXT DEFAULT 'pending',

  -- Review
  reviewed_by TEXT,
  reviewed_at DATETIME,
  rejection_reason TEXT,

  -- Metadata
  country TEXT,
  document_number TEXT,
  expiry_date DATE,

  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_verification_user ON verification_documents(user_id);
CREATE INDEX idx_verification_status ON verification_documents(status);

-- Job ratings/reviews
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,  -- Agent ID
  worker_id TEXT NOT NULL,

  -- Rating (1-5)
  rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),

  -- Review text
  review_text TEXT,

  -- Categories
  quality_rating INTEGER CHECK(quality_rating >= 1 AND quality_rating <= 5),
  speed_rating INTEGER CHECK(speed_rating >= 1 AND speed_rating <= 5),
  communication_rating INTEGER CHECK(communication_rating >= 1 AND communication_rating <= 5),

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (worker_id) REFERENCES users(id)
);

CREATE INDEX idx_reviews_job ON reviews(job_id);
CREATE INDEX idx_reviews_worker ON reviews(worker_id);

-- Sessions table (for auth token management)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,

  -- Device info
  device_type TEXT,
  device_id TEXT,
  fcm_token TEXT,  -- For push notifications

  -- Biometric
  biometric_enabled BOOLEAN DEFAULT 0,

  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Create views for common queries

-- Active jobs view
CREATE VIEW IF NOT EXISTS active_jobs AS
SELECT
  j.*,
  u.name as worker_name,
  u.rating as worker_rating
FROM jobs j
LEFT JOIN users u ON j.worker_id = u.id
WHERE j.status IN ('available', 'assigned', 'in_progress');

-- User wallet balance view
CREATE VIEW IF NOT EXISTS wallet_balances AS
SELECT
  user_id,
  SUM(CASE
    WHEN type = 'job_payment' AND status = 'completed' THEN amount
    WHEN type = 'withdrawal' AND status = 'completed' THEN -amount
    WHEN type = 'bonus' AND status = 'completed' THEN amount
    ELSE 0
  END) as balance
FROM transactions
GROUP BY user_id;
