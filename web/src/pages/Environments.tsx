import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Environment } from '../types';
import { Plus, Trash2, Edit3, Server, RefreshCw, Upload, FileCode, CheckCircle2, AlertCircle } from 'lucide-react';
import { TagBadges } from '../components/TagBadges';
import { ScenarioTagEditor } from '../components/ScenarioTagEditor';
import { parseTags } from '../utils/tags';

export const EnvironmentsPage: React.FC = () => {
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEnv, setEditingEnv] = useState<Environment | null>(null);

  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formVars, setFormVars] = useState('{\n  "BASE_URL": "https://api.example.com",\n  "API_KEY": "sk-xxx"\n}');
  const [formScenarioTags, setFormScenarioTags] = useState<string[]>(['*']);
  const [availableScenarioTags, setAvailableScenarioTags] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  // YAML 导入弹窗状态
  const [yamlModalOpen, setYamlModalOpen] = useState(false);
  const [yamlText, setYamlText] = useState(`name: Remote-DEV
description: "远程开发联调环境"
variables:
  - name: base_url
    value: https://audi-dev.extour-inc.com/dynamic-advisor-audi-dev
    description: ""`);
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlError, setYamlError] = useState('');
  const [yamlSuccess, setYamlSuccess] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, scenariosData] = await Promise.all([
        apiClient.getEnvironments(),
        apiClient.getScenarios().catch(() => []),
      ]);
      setEnvs(data);
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
    setEditingEnv(null);
    setFormName('');
    setFormDesc('');
    setFormVars('{\n  "BASE_URL": "https://api.example.com",\n  "API_KEY": "sk-xxx"\n}');
    setFormScenarioTags(['*']);
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditModal = (env: Environment) => {
    setEditingEnv(env);
    setFormName(env.name);
    setFormDesc(env.description || '');
    setFormScenarioTags(parseTags(env.scenario_tags_json));
    try {
      const parsed = JSON.parse(env.variables_json);
      setFormVars(JSON.stringify(parsed, null, 2));
    } catch {
      setFormVars(env.variables_json);
    }
    setErrorMsg('');
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      JSON.parse(formVars);
    } catch {
      setErrorMsg('环境变量必须是有效的合法 JSON 格式');
      return;
    }

    try {
      if (editingEnv) {
        await apiClient.updateEnvironment(editingEnv.id, {
          name: formName,
          description: formDesc,
          variables_json: formVars,
          scenario_tags_json: JSON.stringify(formScenarioTags),
        });
      } else {
        await apiClient.createEnvironment({
          name: formName,
          description: formDesc,
          variables_json: formVars,
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
    if (!confirm('确定要删除该环境配置吗？')) return;
    try {
      await apiClient.deleteEnvironment(id);
      loadData();
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">环境配置 (Environments)</h2>
          <p className="text-sm text-gray-500 mt-1">管理各被测目标环境的 API BaseURL、鉴权 Token 与网络上下文变量</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 shadow-sm font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
          <button
            onClick={() => {
              setYamlError('');
              setYamlSuccess('');
              setYamlModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 shadow-sm font-medium transition-colors"
          >
            <Upload className="w-4 h-4 text-emerald-600" /> YAML 导入
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm font-medium"
          >
            <Plus className="w-4 h-4" /> 新建环境
          </button>
        </div>
      </div>

      {/* 列表表格展示 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">ID</th>
              <th className="py-3 px-4 w-44">环境名称</th>
              <th className="py-3 px-4 w-36">场景绑定</th>
              <th className="py-3 px-4">描述说明</th>
              <th className="py-3 px-4">包含变量 (Variables)</th>
              <th className="py-3 px-4 w-32">更新时间</th>
              <th className="py-3 px-4 w-28 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {envs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-gray-400">
                  暂无环境配置，请点击右上角新建环境
                </td>
              </tr>
            ) : (
              envs.map((env) => {
                let varKeys: string[] = [];
                try {
                  varKeys = Object.keys(JSON.parse(env.variables_json));
                } catch {}

                return (
                  <tr key={env.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="py-3 px-4 text-center font-mono text-gray-400">#{env.id}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                          <Server className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-bold text-gray-900 text-xs">{env.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <TagBadges tags={env.scenario_tags_json} />
                    </td>
                    <td className="py-3 px-4 text-gray-600 max-w-xs truncate" title={env.description}>
                      {env.description || <span className="text-gray-300 italic">暂无描述</span>}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {varKeys.length > 0 ? (
                          varKeys.map((k) => (
                            <span key={k} className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-700 font-mono rounded">
                              {k}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400 text-[10px]">未配置变量</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs">
                      {new Date(env.updated_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditModal(env)}
                          className="p-1 text-gray-400 hover:text-blue-600 rounded"
                          title="编辑"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(env.id)}
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

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">{editingEnv ? '编辑环境配置' : '新建环境配置'}</h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {errorMsg && (
                <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">{errorMsg}</div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">环境名称 *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="例如: 生产环境 Agent 服务 / 测试沙盒"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">描述说明</label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="说明此环境对应的测试目标或网络集群"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs"
                />
              </div>

              <ScenarioTagEditor
                value={formScenarioTags}
                onChange={setFormScenarioTags}
                availableTags={availableScenarioTags}
                isResource={true}
                label="场景绑定约束"
                helperText="选择允许使用此环境的场景标签（默认全场景通用）"
              />
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  环境变量 (JSON 格式) *
                  <span className="text-[10px] text-gray-400 font-normal ml-2">可在场景脚本中通过 env.KEY 直接引用</span>
                </label>
                <textarea
                  rows={6}
                  required
                  value={formVars}
                  onChange={(e) => setFormVars(e.target.value)}
                  className="w-full p-3 font-mono text-xs border border-gray-300 rounded-lg bg-gray-50"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
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
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* YAML 导入弹窗 */}
      {yamlModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode className="w-5 h-5 text-emerald-600" />
                <h3 className="text-lg font-semibold text-gray-900">通过 YAML 导入环境配置</h3>
              </div>
              <button
                onClick={() => setYamlModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              {yamlError && (
                <div className="p-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{yamlError}</span>
                </div>
              )}
              {yamlSuccess && (
                <div className="p-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>{yamlSuccess}</span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>支持标准 YAML 定义（变量支持列表或键值对）：</span>
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                    选择文件 (.yaml/.yml)
                    <input
                      type="file"
                      accept=".yaml,.yml,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (evt) => {
                            if (evt.target?.result) {
                              setYamlText(evt.target.result as string);
                              setYamlError('');
                            }
                          };
                          reader.readAsText(file);
                        }
                      }}
                    />
                  </label>
                  <span>|</span>
                  <button
                    type="button"
                    onClick={() => {
                      setYamlText(`name: Remote-DEV
description: "远程开发联调环境"
variables:
  - name: base_url
    value: https://audi-dev.extour-inc.com/dynamic-advisor-audi-dev
    description: ""`);
                      setYamlError('');
                    }}
                    className="text-gray-500 hover:text-gray-700 underline"
                  >
                    填充示例
                  </button>
                </div>
              </div>

              <div>
                <textarea
                  rows={9}
                  value={yamlText}
                  onChange={(e) => setYamlText(e.target.value)}
                  className="w-full p-3 font-mono text-xs border border-gray-300 rounded-lg bg-gray-50 focus:bg-white transition-colors"
                  placeholder="粘贴 YAML 配置内容..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setYamlModalOpen(false)}
                  className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={yamlLoading}
                  onClick={async () => {
                    if (!yamlText.trim()) {
                      setYamlError('YAML 内容不能为空');
                      return;
                    }
                    setYamlLoading(true);
                    setYamlError('');
                    setYamlSuccess('');
                    try {
                      await apiClient.importEnvironmentYaml(yamlText);
                      setYamlSuccess('YAML 环境导入成功！');
                      setTimeout(() => {
                        setYamlModalOpen(false);
                        loadData();
                      }, 700);
                    } catch (err: any) {
                      setYamlError(err.message || '导入失败，请检查 YAML 格式');
                    } finally {
                      setYamlLoading(false);
                    }
                  }}
                  className="px-4 py-2 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium disabled:opacity-50"
                >
                  {yamlLoading ? '正在导入...' : '确认导入'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
