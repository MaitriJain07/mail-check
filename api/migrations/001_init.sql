CREATE TABLE users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(254) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  credits       INT UNSIGNED NOT NULL DEFAULT 100,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE api_keys (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(100) NOT NULL,
  prefix       VARCHAR(16) NOT NULL,
  key_hash     CHAR(64) NOT NULL,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at TIMESTAMP(3) NULL,
  revoked_at   TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_key_hash (key_hash),
  KEY idx_api_keys_user (user_id),
  CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE usage_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  api_key_id   BIGINT UNSIGNED NULL,
  email        VARCHAR(320) NOT NULL,
  result       ENUM('deliverable','undeliverable','risky','unknown') NOT NULL,
  credits_used TINYINT UNSIGNED NOT NULL,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_usage_user_created (user_id, created_at),
  KEY idx_usage_api_key (api_key_id),
  CONSTRAINT fk_usage_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_usage_api_key FOREIGN KEY (api_key_id) REFERENCES api_keys (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Fixed-window rate limiter. One row per (bucket, window).
CREATE TABLE rate_limits (
  bucket       VARCHAR(64) NOT NULL,
  window_start INT UNSIGNED NOT NULL,
  hits         INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start),
  KEY idx_rate_limits_window (window_start)
) ENGINE=InnoDB;

CREATE TABLE bulk_jobs (
  id            CHAR(36) NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  api_key_id    BIGINT UNSIGNED NULL,
  status        ENUM('queued','processing','completed') NOT NULL DEFAULT 'queued',
  total         INT UNSIGNED NOT NULL,
  processed     INT UNSIGNED NOT NULL DEFAULT 0,
  deliverable   INT UNSIGNED NOT NULL DEFAULT 0,
  undeliverable INT UNSIGNED NOT NULL DEFAULT 0,
  risky         INT UNSIGNED NOT NULL DEFAULT 0,
  unknown_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed        INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at   TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  KEY idx_bulk_jobs_status (status),
  KEY idx_bulk_jobs_user_created (user_id, created_at),
  CONSTRAINT fk_bulk_jobs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_bulk_jobs_api_key FOREIGN KEY (api_key_id) REFERENCES api_keys (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE bulk_items (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id          CHAR(36) NOT NULL,
  email           VARCHAR(320) NOT NULL,
  status          ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_until    TIMESTAMP(3) NULL,
  result          JSON NULL,
  error           VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_bulk_items_claim (status, next_attempt_at),
  KEY idx_bulk_items_job (job_id, id),
  CONSTRAINT fk_bulk_items_job FOREIGN KEY (job_id) REFERENCES bulk_jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB;
