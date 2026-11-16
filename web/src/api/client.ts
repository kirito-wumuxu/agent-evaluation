import axios from 'axios';
import {
  Environment,
  Scenario,
  Dataset,
  TestCase,
  CaseLatestRun,
  Evaluator,
  EvaluationTask,
  RunRecord,
  RunRecordItem,
  SystemConfig,
  User,
  AuthConfig,
} from '../types';

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('eval_auth_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    if (response.data && response.data.code === 0) {
      return response.data.data;
    }
    return response.data;
  },
  (error) => {
    if (error.response?.status === 401) {
      // 触发全局未登录事件或清除过期 token
      const currentToken = localStorage.getItem('eval_auth_token');
      if (currentToken) {
        localStorage.removeItem('eval_auth_token');
        window.dispatchEvent(new Event('auth_token_expired'));
      }
    }
    const msg = error.response?.data?.message || error.message || '请求失败';
    return Promise.reject(new Error(msg));
  }
);

export const apiClient = {
  // Environments
  getEnvironments: (): Promise<Environment[]> => api.get('/environments'),
  getEnvironment: (id: number): Promise<Environment> => api.get(`/environments/${id}`),
  createEnvironment: (data: Partial<Environment>): Promise<Environment> => api.post('/environments', data),
  updateEnvironment: (id: number, data: Partial<Environment>): Promise<Environment> => api.put(`/environments/${id}`, data),
  deleteEnvironment: (id: number): Promise<{ id: number }> => api.delete(`/environments/${id}`),
  importEnvironmentYaml: (yamlContent: string): Promise<Environment | Environment[]> =>
    api.post('/environments/import-yaml', { yaml_content: yamlContent }),

  // Scenarios
  getScenarios: (): Promise<Scenario[]> => api.get('/scenarios'),
  getScenario: (id: number): Promise<Scenario> => api.get(`/scenarios/${id}`),
  createScenario: (data: Partial<Scenario>): Promise<Scenario> => api.post('/scenarios', data),
  updateScenario: (id: number, data: Partial<Scenario>): Promise<Scenario> => api.put(`/scenarios/${id}`, data),
  deleteScenario: (id: number): Promise<{ id: number }> => api.delete(`/scenarios/${id}`),
  testRunScenario: (data: {
    script: string;
    environment_id?: number;
    variables_json?: string;
    input_data: string;
  }): Promise<{ success: boolean; output?: string; logs?: string; error?: string; latency_ms: number }> =>
    api.post('/scenarios/test-run', data),

  // Datasets & Cases
  getDatasets: (): Promise<Dataset[]> => api.get('/datasets'),
  getDataset: (id: number): Promise<Dataset> => api.get(`/datasets/${id}`),
  createDataset: (data: Partial<Dataset>): Promise<Dataset> => api.post('/datasets', data),
  updateDataset: (id: number, data: Partial<Dataset>): Promise<Dataset> => api.put(`/datasets/${id}`, data),
  deleteDataset: (id: number): Promise<{ id: number }> => api.delete(`/datasets/${id}`),

  getCases: (datasetId: number): Promise<TestCase[]> => api.get(`/datasets/${datasetId}/cases`),
  createCase: (datasetId: number, data: Partial<TestCase>): Promise<TestCase> => api.post(`/datasets/${datasetId}/cases`, data),
  updateCase: (caseId: number, data: Partial<TestCase>): Promise<TestCase> => api.put(`/cases/${caseId}`, data),
  deleteCase: (caseId: number): Promise<{ id: number }> => api.delete(`/cases/${caseId}`),
  getCaseLatestRun: (caseId: number): Promise<CaseLatestRun> => api.get(`/cases/${caseId}/latest-run`),
  batchImportCases: (datasetId: number, cases: any[]): Promise<{ imported_count: number }> =>
    api.post(`/datasets/${datasetId}/cases/batch`, cases),
  exportCases: (datasetId: number): Promise<any[]> => api.get(`/datasets/${datasetId}/export`),

  // Evaluators
  getEvaluators: (): Promise<Evaluator[]> => api.get('/evaluators'),
  getEvaluator: (id: number): Promise<Evaluator> => api.get(`/evaluators/${id}`),
  createEvaluator: (data: Partial<Evaluator>): Promise<Evaluator> => api.post('/evaluators', data),
  updateEvaluator: (id: number, data: Partial<Evaluator>): Promise<Evaluator> => api.put(`/evaluators/${id}`, data),
  deleteEvaluator: (id: number): Promise<{ id: number }> => api.delete(`/evaluators/${id}`),
  testRunEvaluator: (data: {
    type: string;
    config_json: string;
    input?: string;
    output: string;
    expected?: string;
  }): Promise<{ success: boolean; result?: any; error?: string }> => api.post('/evaluators/test-run', data),

  // Tasks
  getTasks: (): Promise<EvaluationTask[]> => api.get('/tasks'),
  getTask: (id: number): Promise<EvaluationTask> => api.get(`/tasks/${id}`),
  createTask: (data: Partial<EvaluationTask>): Promise<EvaluationTask> => api.post('/tasks', data),
  updateTask: (id: number, data: Partial<EvaluationTask>): Promise<EvaluationTask> => api.put(`/tasks/${id}`, data),
  deleteTask: (id: number): Promise<{ id: number }> => api.delete(`/tasks/${id}`),
  runTask: (id: number): Promise<{ run_record_id: number; status: string }> => api.post(`/tasks/${id}/run`),

  // Runs & Human Review
  getRuns: (taskId?: number): Promise<RunRecord[]> => api.get('/runs', { params: { task_id: taskId } }),
  getRun: (id: number): Promise<RunRecord> => api.get(`/runs/${id}`),
  deleteRun: (id: number): Promise<{ id: number }> => api.delete(`/runs/${id}`),
  getRunItems: (
    runId: number,
    params?: { status?: string; machine_passed?: string; reviewed?: string }
  ): Promise<RunRecordItem[]> => api.get(`/runs/${runId}/items`, { params }),
  reviewRunItem: (
    runId: number,
    itemId: number,
    data: {
      human_score: number;
      human_passed: boolean;
      human_comment?: string;
      reviewer_name?: string;
    }
  ): Promise<RunRecordItem> => api.post(`/runs/${runId}/items/${itemId}/review`, data),

  // System Configs
  getSystemConfigs: (): Promise<SystemConfig[]> => api.get('/system-configs'),
  updateSystemConfigs: (data: Record<string, string>): Promise<SystemConfig[]> => api.put('/system-configs', data),

  // Auth & Feishu SSO
  getAuthConfig: (): Promise<AuthConfig> => api.get('/auth/config'),
  getFeishuAuthUrl: (redirectUri?: string): Promise<{ url: string; state: string; redirect_uri: string }> =>
    api.get('/auth/feishu/url', { params: { redirect_uri: redirectUri } }),
  feishuLogin: (code: string): Promise<{ token: string; user: User }> =>
    api.post('/auth/feishu/login', { code }),
  login: (username: string, password: string): Promise<{ token: string; user: User }> =>
    api.post('/auth/login', { username, password }),
  devLogin: (name?: string, role?: string): Promise<{ token: string; user: User }> =>
    api.post('/auth/dev-login', { name, role }),
  getMe: (): Promise<User> => api.get('/auth/me'),
  logout: () => {
    localStorage.removeItem('eval_auth_token');
  },

  // OpenAPI & Skill
  getOpenAPIConfig: (): Promise<{ base_url: string; api_key: string }> => api.get('/openapi/config'),
};
