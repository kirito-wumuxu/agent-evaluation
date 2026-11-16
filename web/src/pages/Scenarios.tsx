import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Scenario, Environment } from '../types';
import { Plus, Trash2, Edit3, Code2, Play, RefreshCw, Terminal, CheckCircle2, AlertCircle } from 'lucide-react';
import { TagBadges } from '../components/TagBadges';
import { ScenarioTagEditor } from '../components/ScenarioTagEditor';
import { parseTags } from '../utils/tags';

export const ScenariosPage: React.FC = () => {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(false);

  // 编辑弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formScript, setFormScript] = useState('');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  // 在线试跑控制台
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [debugScenario, setDebugScenario] = useState<Scenario | null>(null);
  const [debugEnvId, setDebugEnvId] = useState<number | undefined>(undefined);
  const [debugInput, setDebugInput] = useState('{"prompt": "你好，请问如何办理退款？"}');
  const [debugging, setDebugging] = useState(false);
  const [debugResult, setDebugResult] = useState<any>(null);

  const syncTemplate = `/**
 * 【同步直接调用模式】
 * execute(env, input)
 * @param {Object} env 环境变量对象 (来自所选环境配置)
 * @param {any} input 测试用例输入
 * @returns {string|Object} 被测 Agent 的实际输出结果
 */
function execute(env, input) {
    console.log("正在请求环境:", env.BASE_URL);
    
    // 发起 HTTP 请求示例:
    const resp = http.post(env.BASE_URL + "/v1/chat/completions", {
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + env.API_KEY
        },
        body: JSON.stringify({
            prompt: typeof input === 'string' ? input : (input.prompt || JSON.stringify(input))
        }),
        timeout_seconds: 30
    });

    if (resp.status_code !== 200) {
        throw new Error("HTTP 错误: " + resp.status_code + " - " + resp.body);
    }

    const data = resp.json();
    return data.reply || data.choices?.[0]?.message?.content || resp.body;
}`;

  const asyncPollingTemplate = `/**
 * 【异步任务轮询模式】
 * 适用于提交任务后需多次轮询查询接口获取最终回答的 Agent 场景
 */
function execute(env, input) {
    const promptText = typeof input === 'string' ? input : (input.prompt || JSON.stringify(input));
    console.log("【1. 提交异步任务】目标环境:", env.BASE_URL);

    // 1. 发起异步任务提交，获取 task_id
    const submitResp = http.post(env.BASE_URL + "/api/async/create", {
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + env.API_KEY
        },
        body: JSON.stringify({ prompt: promptText }),
        timeout_seconds: 15
    });

    if (submitResp.status_code !== 200 && submitResp.status_code !== 201) {
        throw new Error("异步任务提交失败: HTTP " + submitResp.status_code + " - " + submitResp.body);
    }

    const taskData = submitResp.json();
    const taskId = taskData.task_id || taskData.id;
    console.log("异步任务创建成功，获取 TaskID:", taskId);

    // 2. 轮询结果接口 (最大等待 90 秒，每次间隔 2 秒，使用 sleep 挂起释放 CPU)
    const maxWaitSeconds = 90;
    const pollIntervalMs = 2000;
    const startTime = Date.now();
    let pollCount = 0;

    while ((Date.now() - startTime) < maxWaitSeconds * 1000) {
        pollCount++;
        sleep(pollIntervalMs); // 优雅休眠 2 秒，响应 context 中断

        console.log("第 " + pollCount + " 次轮询查询状态, TaskID:", taskId);
        const queryResp = http.get(env.BASE_URL + "/api/async/status?task_id=" + taskId, {
            headers: { "Authorization": "Bearer " + env.API_KEY },
            timeout_seconds: 10
        });

        if (queryResp.status_code === 200) {
            const res = queryResp.json();
            console.log("轮询返回状态:", res.status);

            // 成功完成，返回真实输出 (将传给 Evaluator 进行打分评估)
            if (res.status === "SUCCESS" || res.status === "COMPLETED") {
                return res.output || res.result || res.reply;
            }

            // 业务执行失败，抛出错误
            if (res.status === "FAILED" || res.status === "ERROR") {
                throw new Error("异步任务处理失败: " + (res.error_message || "未知原因"));
            }
        }
    }

    throw new Error("异步任务查询超时，超过 " + maxWaitSeconds + " 秒未完成");
}`;

  const defaultScriptTemplate = syncTemplate;

  const loadData = async () => {
    setLoading(true);
    try {
      const [scData, envData] = await Promise.all([
        apiClient.getScenarios(),
        apiClient.getEnvironments(),
      ]);
      setScenarios(scData);
      setEnvs(envData);
      if (envData.length > 0 && !debugEnvId) {
        setDebugEnvId(envData[0].id);
      }
    } catch (e: any) {
      alert('加载数据失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingScenario(null);
    setFormName('');
    setFormDesc('');
    setFormScript(defaultScriptTemplate);
    setFormTags([]);
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditModal = (sc: Scenario) => {
    setEditingScenario(sc);
    setFormName(sc.name);
    setFormDesc(sc.description || '');
    setFormScript(sc.script);
    setFormTags(parseTags(sc.tags_json));
    setErrorMsg('');
    setModalOpen(true);
  };

  const openDebugModal = (sc: Scenario) => {
    setDebugScenario(sc);
    setDebugResult(null);
    setDebugModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingScenario) {
        await apiClient.updateScenario(editingScenario.id, {
          name: formName,
          description: formDesc,
          script: formScript,
          tags_json: JSON.stringify(formTags),
        });
      } else {
        await apiClient.createScenario({
          name: formName,
          description: formDesc,
          script: formScript,
          tags_json: JSON.stringify(formTags),
        });
      }
      setModalOpen(false);
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该场景配置吗？')) return;
    try {
      await apiClient.deleteScenario(id);
      loadData();
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
  };

  const handleRunDebug = async () => {
    if (!debugScenario) return;
    setDebugging(true);
    setDebugResult(null);
    try {
      const res = await apiClient.testRunScenario({
        script: debugScenario.script,
        environment_id: debugEnvId,
        input_data: debugInput,
      });
      setDebugResult(res);
    } catch (err: any) {
      setDebugResult({
        success: false,
        error: err.message,
        logs: '',
        latency_ms: 0,
      });
    } finally {
      setDebugging(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">场景配置 (Scenarios)</h2>
          <p className="text-sm text-gray-500 mt-1">
            使用 Goja JavaScript 编写请求逻辑，读取环境配置并调度被测 Agent 获取最终输出
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
            <Plus className="w-4 h-4" /> 新建场景脚本
          </button>
        </div>
      </div>

      {/* 列表表格展示 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">ID</th>
              <th className="py-3 px-4 w-44">场景名称</th>
              <th className="py-3 px-4 w-36">场景标签</th>
              <th className="py-3 px-4">描述说明</th>
              <th className="py-3 px-4 w-24 text-center">代码行数</th>
              <th className="py-3 px-4 w-32">更新时间</th>
              <th className="py-3 px-4 w-36 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {scenarios.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-gray-400">
                  暂无场景脚本，请点击右上角新建场景脚本
                </td>
              </tr>
            ) : (
              scenarios.map((sc) => {
                const lineCount = sc.script.split('\n').length;
                return (
                  <tr key={sc.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="py-3 px-4 text-center font-mono text-gray-400">#{sc.id}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                          <Code2 className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-bold text-gray-900 text-xs">{sc.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <TagBadges tags={sc.tags_json} />
                    </td>
                    <td className="py-3 px-4 text-gray-600 max-w-xs truncate" title={sc.description}>
                      {sc.description || <span className="text-gray-300 italic">暂无描述</span>}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-gray-500">
                      <span className="px-2 py-0.5 bg-gray-100 rounded text-[11px] font-medium">
                        {lineCount} 行
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs">
                      {new Date(sc.updated_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openDebugModal(sc)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded"
                          title="在线调试脚本"
                        >
                          <Play className="w-3 h-3" /> 调试
                        </button>
                        <button
                          onClick={() => openEditModal(sc)}
                          className="p-1 text-gray-400 hover:text-blue-600 rounded"
                          title="编辑代码"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(sc.id)}
                          className="p-1 text-gray-400 hover:text-red-600 rounded"
                          title="删除"
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

      {/* 新建/编辑场景弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">{editingScenario ? '编辑场景脚本' : '新建场景脚本'}</h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
              {errorMsg && (
                <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">{errorMsg}</div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">场景名称 *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="例如: 客服问答接口调用场景"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">场景描述</label>
                  <input
                    type="text"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder="说明接口协议、解析逻辑等"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              <ScenarioTagEditor
                isResource={false}
                label="场景标签 (Tags)"
                helperText="为场景定义标签（例如: cron, order, finance），关联资源将依据此标签进行约束过滤"
                value={formTags}
                onChange={setFormTags}
              />

              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                  <div className="flex items-center gap-2">
                    <label className="block text-xs font-semibold text-gray-700">
                      Goja 脚本 (execute 函数定义) *
                    </label>
                    <span className="text-[10px] text-gray-400 font-mono">
                      内置: http.get/post, sleep(ms), console.log
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setFormScript(syncTemplate)}
                      className="text-[10px] text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded font-medium transition-colors"
                      title="加载同步直接调用模版"
                    >
                      加载【同步调用模板】
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormScript(asyncPollingTemplate)}
                      className="text-[10px] text-purple-700 bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded font-medium transition-colors"
                      title="加载异步提交并使用 sleep 轮询状态的模版"
                    >
                      加载【异步任务轮询模板 (sleep)】
                    </button>
                  </div>
                </div>
                <textarea
                  rows={14}
                  required
                  value={formScript}
                  onChange={(e) => setFormScript(e.target.value)}
                  className="w-full p-3 font-mono text-xs border border-gray-300 rounded-lg bg-slate-900 text-emerald-400"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  保存场景
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 在线试跑与单步调试弹窗 */}
      {debugModalOpen && debugScenario && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-emerald-600" />
                <h3 className="text-lg font-semibold text-gray-900">场景脚本在线调试: {debugScenario.name}</h3>
              </div>
              <button onClick={() => setDebugModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">
                ×
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">选择执行绑定的测试环境</label>
                <select
                  value={debugEnvId}
                  onChange={(e) => setDebugEnvId(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                >
                  {envs.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name} (ID: #{env.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">测试用例输入 (Input)</label>
                <textarea
                  rows={3}
                  value={debugInput}
                  onChange={(e) => setDebugInput(e.target.value)}
                  className="w-full p-2.5 font-mono text-xs border border-gray-300 rounded-lg bg-gray-50"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleRunDebug}
                  disabled={debugging}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-xs disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" /> {debugging ? '正在调度沙箱运行...' : '开始试跑'}
                </button>
              </div>

              {debugResult && (
                <div className="mt-4 space-y-3 pt-3 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      {debugResult.success ? (
                        <span className="text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" /> 执行成功
                        </span>
                      ) : (
                        <span className="text-red-600 flex items-center gap-1">
                          <AlertCircle className="w-4 h-4" /> 运行时异常
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-gray-500">网络耗时: {debugResult.latency_ms} ms</span>
                  </div>

                  {debugResult.output !== undefined && (
                    <div>
                      <div className="text-[11px] font-semibold text-gray-600 mb-1">Agent 实际输出 (Output):</div>
                      <div className="p-3 bg-gray-100 rounded-lg font-mono text-xs text-gray-800 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {debugResult.output}
                      </div>
                    </div>
                  )}

                  {debugResult.error && (
                    <div>
                      <div className="text-[11px] font-semibold text-red-600 mb-1">错误详情:</div>
                      <div className="p-3 bg-red-50 text-red-700 rounded-lg font-mono text-xs whitespace-pre-wrap">
                        {debugResult.error}
                      </div>
                    </div>
                  )}

                  {debugResult.logs && (
                    <div>
                      <div className="text-[11px] font-semibold text-gray-600 mb-1">控制台日志 (console.log):</div>
                      <pre className="p-3 bg-slate-900 text-emerald-400 rounded-lg font-mono text-xs max-h-32 overflow-y-auto">
                        {debugResult.logs}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
