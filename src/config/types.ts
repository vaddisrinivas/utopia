export type ConfigSourceKind = 'local' | 'github' | 'url' | 'notion' | 'sheets';

export type ConfigActor = 'user' | 'ai' | 'sync' | 'import';

export type ConfigValidationStatus = 'unvalidated' | 'valid' | 'invalid';

export type ConfigConflictStatus = 'needs_review' | 'resolved' | 'dismissed';

export type ConfigChangeMode = 'additive' | 'migration_required';

export type ConfigSourceLocation =
  | { path: string }
  | { url: string }
  | { owner: string; repo: string; ref?: string; path: string }
  | { page_id?: string; database_id?: string; data_source_id?: string }
  | { spreadsheet_id: string; range?: string; sheet?: string };

export type ConfigSource = {
  id: string;
  kind: ConfigSourceKind;
  label: string;
  location: ConfigSourceLocation;
  enabled: boolean;
  auto_refresh: boolean;
  refresh_minutes: number;
  precedence: number;
  created_at: string;
  updated_at: string;
};

export type ConfigSnapshot = {
  source_id: string;
  fetched_at: string;
  content_hash: string;
  etag?: string;
  raw: string;
  validation_status: ConfigValidationStatus;
  error?: ConfigValidationError;
};

export type ConfigValidationError = {
  code: string;
  message: string;
  path?: string;
};

export type ConfigConflict = {
  id: string;
  key: string;
  sources: string[];
  reason: string;
  status: ConfigConflictStatus;
  created_at: string;
  resolved_at?: string;
};

export type ControlPlaneState = {
  sources: ConfigSource[];
  snapshots: ConfigSnapshot[];
  conflicts: ConfigConflict[];
  manifests: Record<string, unknown>;
  errors: ConfigValidationError[];
  applied_at?: string;
  last_good_hash?: string;
  mode: ConfigChangeMode;
};
