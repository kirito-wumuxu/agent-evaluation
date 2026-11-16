import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { EvaluationTask, Scenario, Environment, Dataset, Evaluator, TaskEvaluatorConfig } from '../types';
import { Plus, Trash2, Edit3, Play, RefreshCw, Layers, AlertCircle } from 'lucide-react';
import { TagBadges } from '../components/TagBadges';
import { matchScenarioTags } from '../utils/tags';

interface TasksPageProps {
  onNavigateToRuns: (runId?: number) => void;
}

export const TasksPage: React.FC<TasksPageProps> = ({ onNavigateToRuns }) => {
  const [tasks, setTasks] = useState<EvaluationTask[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [loading, setLoading] = useState(false);

  // 弹窗表单状态
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<EvaluationTask | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formScenarioId, setFormScenarioId] = useState<number | undefined>(undefined);
  const [formEnvId, setFormEnvId] = useState<number | undefined>(undefined);
  const [formDatasetId, setFormDatasetId] = useState<number | undefined>(undefined);
  const [formConcurrency, setFormConcurrency] = useState(3);
  const [formMaxRetries, setFormMaxRetries] = useState(0);
  const [formCaseLimit, setFormCaseLimit] = useState<number | string>('');

  // 选中的评测器及权重
  const [selectedEvaluators, setSelectedEvaluators] = useState<TaskEvaluatorConfig[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tList, sList, eList, dList, evList] = await Promise.all([
        apiClient.getTasks(),
        apiClient.getScenarios(),
        apiClient.getEnvironments(),
        apiClient.getDatasets(),
        apiClient.getEvaluators(),
      ]);
      setTasks(tList);
      setScenarios(sList);
      setEnvironments(eList);
      setDatasets(dList);
      setEvaluators(evList);
    } catch (e: any) {
      alert('加载任务数据失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 当前场景及其标签
  const currentScenario = scenarios.find((s) => s.id === formScenarioId);
  const currentScenarioTags = currentScenario?.tags_json;

  // 依据当前场景标签级联过滤的环境、用例集与评测模块
  const compatibleEnvironments = environments.filter((e) =>
    matchScenarioTags(e.scenario_tags_json, currentScenarioTags)
  );
  const compatibleDatasets = datasets.filter((d) =>
    matchScenarioTags(d.scenario_tags_json, currentScenarioTags)
  );
  const compatibleEvaluators = evaluators.filter((ev) =>
    matchScenarioTags(ev.scenario_tags_json, currentScenarioTags)
  );

  const handleScenarioChange = (newScenarioId: number) => {
    setFormScenarioId(newScenarioId);
    const newSc = scenarios.find((s) => s.id === newScenarioId);
    const newScTags = newSc?.tags_json;

    // 检查并级联重置环境
    const newCompEnvs = environments.filter((e) =>
      matchScenarioTags(e.scenario_tags_json, newScTags)
    );
    if (!newCompEnvs.some((e) => e.id === formEnvId)) {
      setFormEnvId(newCompEnvs[0]?.id);
    }

    // 检查并级联重置用例集
    const newCompDs = datasets.filter((d) =>
      matchScenarioTags(d.scenario_tags_json, newScTags)
    );
    if (!newCompDs.some((d) => d.id === formDatasetId)) {
      setFormDatasetId(newCompDs[0]?.id);
    }

    // 级联过滤选中的评测模块
    const newCompEvs = evaluators.filter((ev) =>
      matchScenarioTags(ev.scenario_tags_json, newScTags)
    );
    const compEvIdSet = new Set(newCompEvs.map((e) => e.id));
    const retained = selectedEvaluators.filter((item) => compEvIdSet.has(item.evaluator_id));
    if (retained.length > 0) {
      setSelectedEvaluators(retained);
    } else if (newCompEvs.length > 0) {
      setSelectedEvaluators([{ evaluator_id: newCompEvs[0].id, weight: 1.0 }]);
    } else {
      setSelectedEvaluators([]);
    }
  };

  const openCreateModal = () => {
    setEditingTask(null);
    setFormName('');
    setFormDesc('');

    const firstScenario = scenarios[0];
    const firstScId = firstScenario?.id;
    const firstScTags = firstScenario?.tags_json;

    const compEnvs = environments.filter((e) => matchScenarioTags(e.scenario_tags_json, firstScTags));
    const compDs = datasets.filter((d) => matchScenarioTags(d.scenario_tags_json, firstScTags));
    const compEvs = evaluators.filter((ev) => matchScenarioTags(ev.scenario_tags_json, firstScTags));

    setFormScenarioId(firstScId);
    setFormEnvId(compEnvs[0]?.id);
    setFormDatasetId(compDs[0]?.id);
    setFormConcurrency(3);
    setFormMaxRetries(0);
    setFormCaseLimit('');
    if (compEvs.length > 0) {
      setSelectedEvaluators([{ evaluator_id: compEvs[0].id, weight: 1.0 }]);
    } else {
      setSelectedEvaluators([]);
    }
    setModalOpen(true);
  };

  const openEditModal = (t: EvaluationTask) => {
    setEditingTask(t);
    setFormName(t.name);
    setFormDesc(t.description || '');
    setFormScenarioId(t.scenario_id);
    setFormEnvId(t.environment_id);
    setFormDatasetId(t.dataset_id);
    setFormConcurrency(t.concurrency || 3);
    setFormMaxRetries(t.max_retries || 0);
    setFormCaseLimit(t.case_limit && t.case_limit > 0 ? t.case_limit : '');
    try {
      setSelectedEvaluators(JSON.parse(t.evaluator_configs_json));
    } catch {
      setSelectedEvaluators([]);
    }
    setModalOpen(true);
  };

  const handleToggleEvaluator = (evId: number) => {
    const exists = selectedEvaluators.find((item) => item.evaluator_id === evId);
    if (exists) {
      setSelectedEvaluators(selectedEvaluators.filter((item) => item.evaluator_id !== evId));
    } else {
      setSelectedEvaluators([...selectedEvaluators, { evaluator_id: evId, weight: 1.0 }]);
    }
  };

  const handleWeightChange = (evId: number, weight: number) => {
    setSelectedEvaluators(
      selectedEvaluators.map((item) => (item.evaluator_id === evId ? { ...item, weight } : item))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formScenarioId || !formEnvId || !formDatasetId) {
      alert('请完整选择场景、环境与用例集！');
      return;
    }
    if (selectedEvaluators.length === 0) {
      alert('请至少选择一个评测模块！');
      return;
    }

    const payload = {
      name: formName,
      description: formDesc,
      scenario_id: formScenarioId,
      environment_id: formEnvId,
      dataset_id: formDatasetId,
      evaluator_configs_json: JSON.stringify(selectedEvaluators),
      concurrency: Number(formConcurrency),
      max_retries: Number(formMaxRetries),
      case_limit: Number(formCaseLimit) > 0 ? Number(formCaseLimit) : 0,
    };

    try {
      if (editingTask) {
        await apiClient.updateTask(editingTask.id, payload);
      } else {
        await apiClient.createTask(payload);
      }
      setModalOpen(false);
      loadData();
    } catch (err: any) {
      alert('保存失败: ' + err.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该评测任务吗？')) return;
    try {
      await apiClient.deleteTask(id);
      loadData();
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
  };

  const handleRunTask = async (id: number) => {
    try {
      const res = await apiClient.runTask(id);
      onNavigateToRuns(res.run_record_id);
    } catch (err: any) {
      alert('启动评测任务失败: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">评测任务 (Evaluation Tasks)</h2>
          <p className="text-sm text-gray-500 mt-1">
            装配场景、目标环境、用例集与评测模块组合，列表化直观管理各评测计划
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 shadow-sm font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm font-medium"
          >
            <Plus className="w-4 h-4" /> 创建评测任务
          </button>
        </div>
      </div>

      {/* 列表表格展示 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">ID</th>
              <th className="py-3 px-4 w-44">任务名称</th>
              <th className="py-3 px-4 w-36">场景脚本</th>
              <th className="py-3 px-4 w-32">目标环境</th>
              <th className="py-3 px-4 w-36">用例集</th>
              <th className="py-3 px-4">关联评测器</th>
              <th className="py-3 px-4 w-28 text-center">并发/重试</th>
              <th className="py-3 px-4 w-40 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-gray-400">
                  暂无评测任务，请点击右上角创建评测任务
                </td>
              </tr>
            ) : (
              tasks.map((task) => {
                let evConfigs: TaskEvaluatorConfig[] = [];
                try {
                  evConfigs = JSON.parse(task.evaluator_configs_json);
                } catch {}

                return (
                  <tr key={task.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="py-3 px-4 text-center font-mono text-gray-400">#{task.id}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                          <Layers className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-bold text-gray-900 text-xs">{task.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-700">
                      <div>{task.scenario?.name || `ID #${task.scenario_id}`}</div>
                      <div className="mt-1">
                        <TagBadges tags={task.scenario?.tags_json} />
                      </div>
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-700">
                      <div>{task.environment?.name || `ID #${task.environment_id}`}</div>
                      <div className="mt-1">
                        <TagBadges tags={task.environment?.scenario_tags_json} />
                      </div>
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-700">
                      <div>{task.dataset?.name || `ID #${task.dataset_id}`}</div>
                      <div className="text-[11px] mt-0.5">
                        {task.case_limit && task.case_limit > 0 ? (
                          <span className="text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            前 {task.case_limit} 条 / 共 {task.dataset?.case_count || 0} 条
                          </span>
                        ) : (
                          <span className="text-gray-400">全部 ({task.dataset?.case_count || 0} 条)</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {evConfigs.map((cfg) => {
                          const ev = evaluators.find((e) => e.id === cfg.evaluator_id);
                          return (
                            <span
                              key={cfg.evaluator_id}
                              className="px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-700 rounded font-medium"
                            >
                              {ev ? ev.name : `#${cfg.evaluator_id}`} (w:{cfg.weight})
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center text-gray-500 font-mono">
                      {task.concurrency} 并发 / {task.max_retries} 重试
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleRunTask(task.id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-sm"
                          title="立即触发运行"
                        >
                          <Play className="w-3 h-3 fill-current" /> 运行
                        </button>
                        <button
                          onClick={() => openEditModal(task)}
                          className="p-1 text-gray-400 hover:text-blue-600 rounded"
                          title="编辑任务"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="p-1 text-gray-400 hover:text-red-600 rounded"
                          title="删除任务"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 创建/编辑任务弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">{editingTask ? '编辑评测任务' : '创建评测任务'}</h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">任务名称 *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="如: 客服Agent回归基线评测"
                    className="w-full px-3 py-2 border rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">描述</label>
                  <input
                    type="text"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder="任务目标与背景说明"
                    className="w-full px-3 py-2 border rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-700">场景脚本 (Scenario) *</label>
                  <select
                    value={formScenarioId}
                    onChange={(e) => handleScenarioChange(Number(e.target.value))}
                    className="w-full px-2.5 py-2 border rounded-lg text-xs bg-white font-medium"
                  >
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="pt-0.5">
                    <TagBadges tags={currentScenarioTags} />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-700">目标环境 (Environment) *</label>
                  <select
                    value={formEnvId || ''}
                    onChange={(e) => setFormEnvId(Number(e.target.value))}
                    className="w-full px-2.5 py-2 border rounded-lg text-xs bg-white"
                  >
                    {compatibleEnvironments.length === 0 ? (
                      <option value="" disabled>无匹配环境 (需配置标签或设通用)</option>
                    ) : (
                      compatibleEnvironments.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))
                    )}
                  </select>
                  {compatibleEnvironments.length === 0 ? (
                    <p className="text-[10px] text-red-500">无匹配环境，请先配置通用环境或对应标签</p>
                  ) : (
                    <p className="text-[10px] text-gray-400">已按场景标签过滤 ({compatibleEnvironments.length} 个可用)</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-700">评测用例集 (Dataset) *</label>
                  <select
                    value={formDatasetId || ''}
                    onChange={(e) => setFormDatasetId(Number(e.target.value))}
                    className="w-full px-2.5 py-2 border rounded-lg text-xs bg-white"
                  >
                    {compatibleDatasets.length === 0 ? (
                      <option value="" disabled>无匹配用例集 (需配置标签或设通用)</option>
                    ) : (
                      compatibleDatasets.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.case_count}条)
                        </option>
                      ))
                    )}
                  </select>
                  {compatibleDatasets.length === 0 ? (
                    <p className="text-[10px] text-red-500">无匹配用例集，请先配置通用集或对应标签</p>
                  ) : (
                    <p className="text-[10px] text-gray-400">已按场景标签过滤 ({compatibleDatasets.length} 个可用)</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">并发执行数 (Concurrency)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={formConcurrency}
                    onChange={(e) => setFormConcurrency(Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">单用例重试次数 (Retries)</label>
                  <input
                    type="number"
                    min={0}
                    max={3}
                    value={formMaxRetries}
                    onChange={(e) => setFormMaxRetries(Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg text-xs"
                  />
                </div>
                <div>
                  {(() => {
                    const selDs = datasets.find((d) => d.id === formDatasetId);
                    const totalCases = selDs?.case_count || 0;
                    return (
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center justify-between">
                          <span>执行用例数量</span>
                          <span className="text-[10px] text-gray-400 font-normal">
                            共 {totalCases} 条
                          </span>
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={totalCases > 0 ? totalCases : undefined}
                          placeholder={totalCases > 0 ? `全部 (${totalCases}条)` : '全部'}
                          value={formCaseLimit}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setFormCaseLimit('');
                            } else {
                              const num = parseInt(val, 10);
                              if (isNaN(num)) {
                                setFormCaseLimit('');
                              } else {
                                setFormCaseLimit(num);
                              }
                            }
                          }}
                          className="w-full px-3 py-2 border rounded-lg text-xs"
                        />
                        <span className="text-[10px] text-gray-400 block mt-1">
                          默认全部，可填 1 ~ {totalCases || '最大值'}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-gray-700">
                    选择关联评测模块与权重 (Evaluator Pipeline) *
                  </label>
                  <span className="text-[11px] text-gray-500">
                    已按场景标签筛选出 {compatibleEvaluators.length} 个可用评测器
                  </span>
                </div>
                <div className="space-y-2 border border-gray-200 rounded-lg p-3 bg-gray-50/50 max-h-56 overflow-y-auto">
                  {compatibleEvaluators.length === 0 ? (
                    <div className="p-4 text-center text-xs text-gray-400">
                      当前场景暂无绑定的评测模块，请在评测模块管理中为评测器绑定当前场景标签或勾选“全场景通用 (*)”
                    </div>
                  ) : (
                    compatibleEvaluators.map((ev) => {
                      const sel = selectedEvaluators.find((item) => item.evaluator_id === ev.id);
                      const checked = !!sel;
                      return (
                        <div
                          key={ev.id}
                          className={`flex items-center justify-between p-2 rounded-md border text-xs transition-colors ${
                            checked ? 'bg-indigo-50/50 border-indigo-200' : 'bg-white border-gray-200'
                          }`}
                        >
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleEvaluator(ev.id)}
                              className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="font-semibold text-gray-800">{ev.name}</span>
                            <span className="text-gray-400">({ev.type === 'llm_judge' ? '大模型裁判' : '脚本裁判'})</span>
                            <TagBadges tags={ev.scenario_tags_json} />
                          </label>

                          {checked && (
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">权重:</span>
                              <input
                                type="number"
                                step="0.1"
                                min="0.1"
                                max="10"
                                value={sel?.weight || 1.0}
                                onChange={(e) => handleWeightChange(ev.id, parseFloat(e.target.value))}
                                className="w-16 px-2 py-1 border rounded text-xs text-center bg-white"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button type="submit" className="px-4 py-2 text-xs bg-blue-600 text-white rounded-lg font-medium">
                  保存任务
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
