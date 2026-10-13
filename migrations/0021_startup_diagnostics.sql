CREATE TABLE startup_diagnostic (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('browser', 'server')),
  detail TEXT NOT NULL CHECK (length(detail) <= 2048)
);
CREATE INDEX startup_diagnostic_created ON startup_diagnostic(created_at);
