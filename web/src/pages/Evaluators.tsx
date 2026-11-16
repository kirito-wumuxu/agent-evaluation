import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Evaluator, EvaluatorType } from '../types';
import { Plus, Trash2, Edit3, ShieldCheck, Play, RefreshCw, Cpu, Code2, Sparkles, FileCode } from 'lucide-react';
import { TagBadges } from '../components/TagBadges';
import { ScenarioTagEditor } from '../components/ScenarioTagEditor';
import { parseTags } from '../utils/tags';

const DEFAULT_LLM_PROMPT = `你是一名严格的 Agent 评测裁判。
请评估被测 Agent 的回答是否准确解答了用户的提问，并是否符合期望输出。

[用例输入]
{input}

[期望标准输出]
{expected}

[Agent 实际输出]
{actual}

请输出打分 (0-100)，判定是否通过 (true/false)，并给出评价理由。
严格按以下 JSON 格式输出，不要附加任何其他多余文本：
{
  "score": 85,
  "passed": true,
  "reason": "简述通过或扣分理由"
}`;

const JSON_COMPARE_LLM_PROMPT = `你是一名专业的数据一致性评测裁判。
请对比被测 Agent 输出的结构化数据与期望数据：

- 期望标题: {expected.task_title}
- 实际标题: {actual.task_title}
- 期望触发规则: {expected.trigger_dsl}
- 实际触发规则: {actual.trigger_dsl}
- 期望描述: {expected.task_description}
- 实际描述: {actual.task_description}

请综合评估字段的一致性与语义完整度，严格按以下 JSON 格式返回打分：
{
  "score": 90,
  "passed": true,
  "reason": "核心字段一致，触发规则正确"
}`;

const DEFAULT_SCRIPT_CODE = `/**
 * Script Judge 脚本评测函数
 * @param {string} input - 用例输入 (若为 JSON 可直接 JSON.parse)
 * @param {string} output - Agent 实际输出 (Actual)
 * @param {string} expected - 期望标准输出 (Expected)
 * @returns {{ score: number, passed: boolean, reason: string }}
 */
function evaluate(input, output, expected) {
  // 示例: 支持文本或 JSON 字段比对
  var act = output;
  var exp = expected;
  try { act = JSON.parse(output); } catch (e) {}
  try { exp = JSON.parse(expected); } catch (e) {}

  if (typeof exp === 'object' && exp !== null && typeof act === 'object' && act !== null) {
    // 对比 JSON 字段
    var keys = Object.keys(exp);
    var matchCount = 0;
    keys.forEach(function(k) {
      if (String(exp[k]).trim() === String(act[k]).trim()) {
        matchCount++;
      }
    });
    var score = Math.round((matchCount / (keys.length || 1)) * 100);
    return {
      score: score,
      passed: score >= 80,
      reason: "字段匹配率: " + matchCount + "/" + keys.length + " (" + score + "分)"
    };
  }

  // 基础文本匹配
  var isMatch = output.indexOf(expected) !== -1;
  return {
    score: isMatch ? 100 : 0,
    passed: isMatch,
    reason: isMatch ? "完全命中期望关键信息" : "未命中期望关键信息"
  };
}`;

const SCRIPT_CONTAINS_CODE = `/**
 * 关键词与礼貌用语综合评分函数
 */
function evaluate(input, output, expected) {
  if (!output || output.trim() === "") {
    return { score: 0, passed: false, reason: "Agent 实际输出为空" };
  }
  var hasExpected = expected ? output.indexOf(expected) !== -1 : true;
  var isPolite = output.indexOf("您") !== -1 || output.indexOf("请") !== -1 || output.indexOf("感谢") !== -1;
  
  var score = 50;
  if (hasExpected) score += 30;
  if (isPolite) score += 20;

  return {
    score: score,
    passed: hasExpected,
    reason: "核心信息命中: " + (hasExpected ? "是" : "否") + ", 礼貌敬语: " + (isPolite ? "+20分" : "+0分")
  };
}`;

export const EvaluatorsPage: React.FC = () => {
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [loading, setLoading] = useState(false);

  // 编辑弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEv, setEditingEv] = useState<Evaluator | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formType, setFormType] = useState<EvaluatorType>('llm_judge');
  const [llmPrompt, setLlmPrompt] = useState(DEFAULT_LLM_PROMPT);
  const [llmModel, setLlmModel] = useState('');
  const [scriptCode, setScriptCode] = useState(DEFAULT_SCRIPT_CODE);
  const [formScenarioTags, setFormScenarioTags] = useState<string[]>(['*']);
  const [availableScenarioTags, setAvailableScenarioTags] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  // 在线单测弹窗
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [debugEv, setDebugEv] = useState<Evaluator | null>(null);
  const [debugInput, setDebugInput] = useState('{"goal_text":"每日 10:00 播报世界杯战况"}');
  const [debugExpected, setDebugExpected] = useState('{"task_title":"世界杯战况播报","trigger_dsl":"0 0 10 * * ?"}');
  const [debugOutput, setDebugOutput] = useState('{"task_title":"世界杯战况播报","trigger_dsl":"0 0 10 * * ?"}');
  const [debugging, setDebugging] = useState(false);
  const [debugResult, setDebugResult] = useState<any>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, scenariosData] = await Promise.all([
        apiClient.getEvaluators(),
        apiClient.getScenarios().catch(() => []),
      ]);
      setEvaluators(data);
      const tagsSet = new Set<string>();
      scenariosData.forEach(sc => {
        parseTags(sc.tags_json).forEach(t => {
          if (t !== '*' && t.toLowerCase() !== 'global') tagsSet.add(t);
        });
      });
      setAvailableScenarioTags(Array.from(tagsSet));
    } catch (e: any) {
      alert('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingEv(null);
    setFormName('');
    setFormDesc('');
    setFormType('llm_judge');
    setLlmPrompt(DEFAULT_LLM_PROMPT);
    setLlmModel('');
    setScriptCode(DEFAULT_SCRIPT_CODE);
    setFormScenarioTags(['*']);
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditModal = (ev: Evaluator) => {
    setEditingEv(ev);
    setFormName(ev.name);
    setFormDesc(ev.description || '');
    setFormType(ev.type);
    setFormScenarioTags(parseTags(ev.scenario_tags_json));

    try {
      const cfg = JSON.parse(ev.config_json || '{}');
      if (ev.type === 'llm_judge') {
        setLlmPrompt(cfg.prompt_template || DEFAULT_LLM_PROMPT);
        setLlmModel(cfg.model || '');
      } else {
        setScriptCode(cfg.script || DEFAULT_SCRIPT_CODE);
      }
    } catch {
      if (ev.type === 'llm_judge') {
        setLlmPrompt(DEFAULT_LLM_PROMPT);
        setLlmModel('');
      } else {
        setScriptCode(DEFAULT_SCRIPT_CODE);
      }
    }
    setErrorMsg('');
    setModalOpen(true);
  };

  const insertVariable = (variable: string) => {
    setLlmPrompt((prev) => prev + variable);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    let configJson = '{}';
    if (formType === 'llm_judge') {
      if (!llmPrompt.trim()) {
        setErrorMsg('LLM Judge 必须填写 Prompt 模板');
        return;
      }
      configJson = JSON.stringify({
        prompt_template: llmPrompt,
        model: llmModel.trim(),
      });
    } else {
      if (!scriptCode.trim()) {
        setErrorMsg('Script Judge 必须填写 JavaScript 脚本函数代码');
        return;
      }
      configJson = JSON.stringify({
        script: scriptCode,
      });
    }

    try {
      if (editingEv) {
        await apiClient.updateEvaluator(editingEv.id, {
          name: formName,
          description: formDesc,
          type: formType,
          config_json: configJson,
          scenario_tags_json: JSON.stringify(formScenarioTags),
        });
      } else {
        await apiClient.createEvaluator({
          name: formName,
          description: formDesc,
          type: formType,
          config_json: configJson,
          scenario_tags_json: JSON.stringify(formScenarioTags),
        });
      }
      setModalOpen(false);
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该评测模块吗？')) return;
    try {
      await apiClient.deleteEvaluator(id);
      loadData();
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
  };

  const handleRunDebug = async () => {
    if (!debugEv) return;
    setDebugging(true);
    setDebugResult(null);
    try {
      const res = await apiClient.testRunEvaluator({
        type: debugEv.type,
        config_json: debugEv.config_json,
        input: debugInput,
        output: debugOutput,
        expected: debugExpected,
      });
      setDebugResult(res);
    } catch (err: any) {
      setDebugResult({
        success: false,
        error: err.message,
      });
    } finally {
      setDebugging(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">评测模块 (Evaluators)</h2>
          <p className="text-sm text-gray-500 mt-1">
            支持两类评测器：大模型裁判 (LLM Judge) 与自定义脚本函数裁判 (Script Judge)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 shadow-sm font-medium transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> 新建评测模块
          </button>
        </div>
      </div>

      {/* 评测器类型介绍卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-purple-50/50 border border-purple-100 rounded-xl">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <h4 className="font-semibold text-xs text-purple-900">大模型裁判 (LLM Judge)</h4>
          </div>
          <p className="text-[11px] text-purple-700 leading-relaxed">
            使用 Prompt Template 驱动 LLM 综合打分。支持通过 <code className="bg-purple-100 px-1 py-0.5 rounded font-mono">{"{expected.key}"}</code> 与 <code className="bg-purple-100 px-1 py-0.5 rounded font-mono">{"{actual.key}"}</code> 点号语法从 JSON 数据中提取任意字段值进行精准语义比对。
          </p>
        </div>
        <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
          <div className="flex items-center gap-2 mb-1">
            <Code2 className="w-4 h-4 text-blue-600" />
            <h4 className="font-semibold text-xs text-blue-900">脚本函数裁判 (Script Judge)</h4>
          </div>
          <p className="text-[11px] text-blue-700 leading-relaxed">
            执行 JavaScript 沙箱函数 <code className="bg-blue-100 px-1 py-0.5 rounded font-mono">evaluate(input, output, expected)</code>，支持对结构化 JSON 字段、阈值范围与复杂业务规则进行确定性逻辑校验与精准打分。
          </p>
        </div>
      </div>

      {/* 列表表格展示 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">ID</th>
              <th className="py-3 px-4 w-48">模块名称</th>
              <th className="py-3 px-4 w-36">场景绑定</th>
              <th className="py-3 px-4 w-36">评测器类型</th>
              <th className="py-3 px-4">描述与配置摘要</th>
              <th className="py-3 px-4 w-32">更新时间</th>
              <th className="py-3 px-4 w-36 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {evaluators.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-gray-400">
                  暂无评测模块，请点击右上角新建评测模块
                </td>
              </tr>
            ) : (
              evaluators.map((ev) => {
                const isLlm = ev.type === 'llm_judge';
                return (
                  <tr key={ev.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="py-3 px-4 text-center font-mono text-gray-400">#{ev.id}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded flex items-center justify-center font-bold ${
                          isLlm ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'
                        }`}>
                          {isLlm ? <Sparkles className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
                        </div>
                        <span className="font-bold text-gray-900 text-xs">{ev.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <TagBadges tags={ev.scenario_tags_json} />
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border ${
                        isLlm ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}>
                        {isLlm ? '大模型裁判' : '脚本裁判'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600 max-w-sm truncate" title={ev.description || ev.config_json}>
                      <span>{ev.description || '无描述'}</span>
                      <span className="text-gray-400 font-mono text-[11px] ml-2">({ev.config_json.slice(0, 45)}...)</span>
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs">
                      {new Date(ev.updated_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setDebugEv(ev);
                            setDebugResult(null);
                            setDebugModalOpen(true);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded transition-colors"
                          title="试跑单测"
                        >
                          <Play className="w-3 h-3" /> 试跑
                        </button>
                        <button
                          onClick={() => openEditModal(ev)}
                          className="p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
                          title="编辑"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(ev.id)}
                          className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
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

      {/* 新建/编辑评测模块弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">{editingEv ? '编辑评测模块' : '新建评测模块'}</h3>
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
                  <label className="block text-xs font-semibold text-gray-700 mb-1">模块名称 *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="例如: 世界杯意图语义评测 / JSON 字段匹配脚本"
                    className="w-full px-3 py-2 border rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">评测器类型 *</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={!!editingEv}
                      onClick={() => setFormType('llm_judge')}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                        formType === 'llm_judge'
                          ? 'bg-purple-50 border-purple-300 text-purple-900 font-bold'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      } ${editingEv ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      大模型裁判 (LLM Judge)
                    </button>
                    <button
                      type="button"
                      disabled={!!editingEv}
                      onClick={() => setFormType('script')}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                        formType === 'script'
                          ? 'bg-blue-50 border-blue-300 text-blue-900 font-bold'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      } ${editingEv ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      <Code2 className="w-3.5 h-3.5 text-blue-600" />
                      脚本裁判 (Script Judge)
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">模块描述</label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="说明此评测模块的打分依据与适用场景"
                  className="w-full px-3 py-2 border rounded-lg text-xs"
                />
              </div>

              <ScenarioTagEditor
                value={formScenarioTags}
                onChange={setFormScenarioTags}
                availableTags={availableScenarioTags}
                isResource={true}
                label="场景绑定约束"
                helperText="选择允许使用此评测模块的场景标签（默认全场景通用）"
              />

              {/* LLM Judge 专属配置面板 */}
              {formType === 'llm_judge' && (
                <div className="space-y-3 p-4 bg-purple-50/30 border border-purple-200 rounded-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-purple-950">Prompt 模板定义 *</label>
                      <span className="text-[11px] text-gray-500">
                        支持占位符提取字段，大模型将根据此提示词执行判定并返回得分
                      </span>
                    </div>
                    {/* 模板快捷载入 */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-400">快速模板:</span>
                      <button
                        type="button"
                        onClick={() => setLlmPrompt(DEFAULT_LLM_PROMPT)}
                        className="px-2 py-0.5 text-[11px] bg-white border border-gray-200 hover:bg-purple-50 text-purple-700 rounded transition-colors"
                      >
                        默认通用裁判
                      </button>
                      <button
                        type="button"
                        onClick={() => setLlmPrompt(JSON_COMPARE_LLM_PROMPT)}
                        className="px-2 py-0.5 text-[11px] bg-white border border-gray-200 hover:bg-purple-50 text-purple-700 rounded transition-colors"
                      >
                        JSON 字段抽取比对
                      </button>
                    </div>
                  </div>

                  {/* 变量快捷插入芯片 */}
                  <div className="p-2.5 bg-white border border-purple-100 rounded-lg">
                    <div className="text-[11px] font-semibold text-purple-900 mb-1.5">
                      点击快捷插入模板占位符 (支持提取 JSON 字段):
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs font-mono">
                      {[
                        { label: '{expected}', desc: '完整期望输出' },
                        { label: '{expected.key}', desc: '期望中指定字段' },
                        { label: '{actual}', desc: '完整实际输出' },
                        { label: '{actual.key}', desc: '实际输出中指定字段' },
                        { label: '{input}', desc: '完整用例输入' },
                        { label: '{input.key}', desc: '输入中指定字段' },
                        { label: '{time}', desc: '当前时间戳' },
                      ].map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => insertVariable(item.label)}
                          className="px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-800 rounded border border-purple-200 text-[11px] flex items-center gap-1 transition-colors"
                          title={item.desc}
                        >
                          <span>{item.label}</span>
                          <span className="text-[9px] text-purple-400 font-sans">({item.desc})</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <textarea
                      rows={10}
                      required
                      value={llmPrompt}
                      onChange={(e) => setLlmPrompt(e.target.value)}
                      className="w-full p-3 font-mono text-xs border border-purple-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="请在此输入 LLM 评测提示词模板..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      覆盖模型名称 (可选)
                    </label>
                    <input
                      type="text"
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value)}
                      placeholder="留空则自动继承系统全局配置的 Judge 模型 (如 gpt-4o-mini)"
                      className="w-full px-3 py-1.5 border rounded-lg text-xs font-mono bg-white"
                    />
                  </div>
                </div>
              )}

              {/* Script Judge 专属配置面板 */}
              {formType === 'script' && (
                <div className="space-y-3 p-4 bg-blue-50/30 border border-blue-200 rounded-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-blue-950">
                        JavaScript 评测函数 evaluate(input, output, expected) *
                      </label>
                      <span className="text-[11px] text-gray-500">
                        沙箱运行标准 JS 函数，必须返回包含 score (0-100), passed (boolean), reason (string) 的对象
                      </span>
                    </div>
                    {/* 脚本模板快捷载入 */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-400">快速脚本:</span>
                      <button
                        type="button"
                        onClick={() => setScriptCode(DEFAULT_SCRIPT_CODE)}
                        className="px-2 py-0.5 text-[11px] bg-white border border-gray-200 hover:bg-blue-50 text-blue-700 rounded transition-colors"
                      >
                        JSON 字段比对函数
                      </button>
                      <button
                        type="button"
                        onClick={() => setScriptCode(SCRIPT_CONTAINS_CODE)}
                        className="px-2 py-0.5 text-[11px] bg-white border border-gray-200 hover:bg-blue-50 text-blue-700 rounded transition-colors"
                      >
                        关键词敬语判定函数
                      </button>
                    </div>
                  </div>

                  <div>
                    <textarea
                      rows={12}
                      required
                      value={scriptCode}
                      onChange={(e) => setScriptCode(e.target.value)}
                      className="w-full p-3 font-mono text-xs border border-blue-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="function evaluate(input, output, expected) { ... }"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button type="submit" className="px-4 py-2 text-xs bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
                  保存评测模块
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 在线单测调试弹窗 */}
      {debugModalOpen && debugEv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                {debugEv.type === 'llm_judge' ? (
                  <Sparkles className="w-4 h-4 text-purple-600" />
                ) : (
                  <Code2 className="w-4 h-4 text-blue-600" />
                )}
                试跑调试: {debugEv.name}
              </h3>
              <button onClick={() => setDebugModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">
                ×
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">用例输入 (Input)</label>
              <textarea
                rows={2}
                value={debugInput}
                onChange={(e) => setDebugInput(e.target.value)}
                className="w-full p-2 border rounded-lg text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">期望标准 (Expected)</label>
              <textarea
                rows={3}
                value={debugExpected}
                onChange={(e) => setDebugExpected(e.target.value)}
                className="w-full p-2 border rounded-lg text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Agent 实际输出 (Actual Output)</label>
              <textarea
                rows={3}
                value={debugOutput}
                onChange={(e) => setDebugOutput(e.target.value)}
                className="w-full p-2 border rounded-lg text-xs font-mono bg-gray-50"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleRunDebug}
                disabled={debugging}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" /> {debugging ? '正在评估中...' : '开始执行评估'}
              </button>
            </div>

            {debugResult && (
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 mt-2 space-y-2">
                {debugResult.success && debugResult.result ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-800">
                        判定结果:{' '}
                        {debugResult.result.passed ? (
                          <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            合格 (PASSED)
                          </span>
                        ) : (
                          <span className="text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                            未通过 (FAILED)
                          </span>
                        )}
                      </span>
                      <span className="text-base font-mono font-bold text-blue-600">
                        {debugResult.result.score} 分
                      </span>
                    </div>
                    <div className="text-xs text-gray-700 bg-white p-2.5 rounded border border-gray-200">
                      <span className="font-semibold text-gray-900">理由说明: </span>
                      {debugResult.result.reason}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-red-600 font-mono">
                    评估失败: {debugResult.error || '未知错误'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
