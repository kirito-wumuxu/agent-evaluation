export interface Environment {
  id: number;
  name: string;
  description: string;
  variables_json: string;
  scenario_tags_json?: string;
  created_at: string;
  updated_at: string;
}

export interface Scenario {
  id: number;
  name: string;
  description: string;
  script: string;
  tags_json?: string;
  created_at: string;
  updated_at: string;
}

export interface DatasetColumn {
  key: string;
  label: string;
  type: 'input' | 'expected' | 'metadata';
}

export interface Dataset {
  id: number;
  name: string;
  description: string;
  columns_json?: string;
  scenario_tags_json?: string;
  case_count: number;
  created_at: string;
  updated_at: string;
}

export interface TestCase {
  id: number;
  dataset_id: number;
  input_data: string;
  expected_output: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export type EvaluatorType = 'llm_judge' | 'script';

export interface Evaluator {
  id: number;
  name: string;
  description: string;
  type: EvaluatorType;
  config_json: string;
  scenario_tags_json?: string;
  created_at: string;
  updated_at: string;
}

export interface TaskEvaluatorConfig {
  evaluator_id: number;
  weight: number;
}

export interface EvaluationTask {
  id: number;
  name: string;
  description: string;
  scenario_id: number;
  environment_id: number;
  dataset_id: number;
  evaluator_configs_json: string;
  concurrency: number;
  max_retries: number;
  case_limit?: number;
  scenario?: Scenario;
  environment?: Environment;
  dataset?: Dataset;
  created_at: string;
  updated_at: string;
}

export type RunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';

export interface RunRecord {
  id: number;
  task_id: number;
  task?: EvaluationTask;
  status: RunStatus;
  total_count: number;
  success_count: number;
  error_count: number;
  machine_pass_count: number;
  machine_avg_score: number;
  human_pass_count: number;
  human_avg_score: number;
  reviewed_count: number;
  started_at?: string;
  finished_at?: string;
  created_at: string;
}

export type RunItemStatus = 'COMPLETED' | 'ERROR';

export interface EvaluatorDetail {
  evaluator_id: number;
  evaluator_name: string;
  type: string;
  weight: number;
  score: number;
  passed: boolean;
  reason: string;
}

export interface RunRecordItem {
  id: number;
  run_record_id: number;
  test_case_id: number;
  test_case?: TestCase;
  input_data: string;
  expected_output: string;
  actual_output: string;
  status: RunItemStatus;
  error_message?: string;
  latency_ms: number;
  execution_log?: string;
  machine_score: number;
  machine_passed: boolean;
  machine_details_json: string;
  human_score?: number | null;
  human_passed?: boolean | null;
  human_comment?: string;
  reviewer_name?: string;
  reviewed_at?: string | null;
  created_at: string;
}

export interface CaseLatestRun {
  has_run: boolean;
  run_record_id?: number;
  task_name?: string;
  item_id?: number;
  status?: RunItemStatus;
  actual_output?: string;
  expected_output?: string;
  input_data?: string;
  latency_ms?: number;
  machine_score?: number;
  machine_passed?: boolean;
  machine_details_json?: string;
  human_score?: number | null;
  human_passed?: boolean | null;
  human_comment?: string;
  reviewer_name?: string;
  reviewed_at?: string | null;
  error_message?: string;
  execution_log?: string;
  created_at?: string;
}

export interface SystemConfig {
  key: string;
  value: string;
  description: string;
  updated_at: string;
}

export interface User {
  id: number;
  username?: string;
  open_id?: string;
  union_id?: string;
  name: string;
  en_name?: string;
  avatar_url?: string;
  email?: string;
  mobile?: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface AuthConfig {
  feishu_sso_enabled: boolean;
  feishu_app_id: string;
  configured: boolean;
  redirect_uri?: string;
}

export interface SystemVersionInfo {
  current_version: string;
  git_commit: string;
  build_time: string;
  latest_version?: string;
  has_update: boolean;
  release_notes?: string;
  published_at?: string;
  asset_url?: string;
  asset_name?: string;
  asset_size?: number;
  checksum_url?: string;
  check_error?: string;
}

