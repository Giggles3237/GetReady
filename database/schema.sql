CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  role ENUM('admin', 'salesperson', 'manager', 'bmw_genius', 'detailer', 'service_advisor') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE action_definitions (
  action_key VARCHAR(64) PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  role ENUM('admin', 'salesperson', 'manager', 'bmw_genius', 'detailer', 'service_advisor') NOT NULL,
  action_type ENUM('status', 'flag') NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE vehicles (
  id VARCHAR(36) PRIMARY KEY,
  stock_number VARCHAR(30) NOT NULL UNIQUE,
  year INT NOT NULL,
  make VARCHAR(50) NOT NULL,
  model VARCHAR(50) NOT NULL,
  color VARCHAR(50) NULL,
  status VARCHAR(50) NOT NULL,
  due_date DATETIME NOT NULL,
  current_location VARCHAR(80) NULL,
  assigned_role VARCHAR(40) NULL,
  assigned_user_id VARCHAR(36) NULL,
  submitted_by_user_id VARCHAR(36) NULL,
  needs_service BOOLEAN NOT NULL DEFAULT FALSE,
  needs_bodywork BOOLEAN NOT NULL DEFAULT FALSE,
  recall_checked BOOLEAN NOT NULL DEFAULT FALSE,
  recall_open BOOLEAN NOT NULL DEFAULT FALSE,
  recall_completed BOOLEAN NOT NULL DEFAULT FALSE,
  fueled BOOLEAN NOT NULL DEFAULT FALSE,
  qc_required BOOLEAN NOT NULL DEFAULT FALSE,
  qc_completed BOOLEAN NOT NULL DEFAULT FALSE,
  service_status ENUM('not_needed', 'pending', 'in_progress', 'completed') NOT NULL DEFAULT 'not_needed',
  bodywork_status ENUM('not_needed', 'pending', 'in_progress', 'completed') NOT NULL DEFAULT 'not_needed',
  service_notes TEXT NULL,
  bodywork_notes TEXT NULL,
  notes TEXT NULL,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vehicle_assigned_user FOREIGN KEY (assigned_user_id) REFERENCES users(id),
  CONSTRAINT fk_vehicle_submitted_by FOREIGN KEY (submitted_by_user_id) REFERENCES users(id)
);

CREATE TABLE audit_logs (
  id VARCHAR(36) PRIMARY KEY,
  vehicle_id VARCHAR(36) NULL,
  user_id VARCHAR(36) NOT NULL,
  action_type VARCHAR(80) NOT NULL,
  field_changed VARCHAR(191) NOT NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE user_sessions (
  session_id VARCHAR(191) PRIMARY KEY,
  expires_at DATETIME NOT NULL,
  data LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_role ON users(role);

CREATE INDEX idx_actions_role_enabled ON action_definitions(role, enabled, sort_order);

CREATE INDEX idx_vehicle_status ON vehicles(status);
CREATE INDEX idx_vehicle_due_date ON vehicles(due_date);
CREATE INDEX idx_vehicle_assigned_role ON vehicles(assigned_role);
CREATE INDEX idx_vehicle_assigned_user ON vehicles(assigned_user_id);

CREATE INDEX idx_audit_vehicle_created ON audit_logs(vehicle_id, created_at);
CREATE INDEX idx_audit_user_created ON audit_logs(user_id, created_at);
CREATE INDEX idx_audit_action_created ON audit_logs(action_type, created_at);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);
