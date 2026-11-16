import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { SystemConfig } from '../types';
import { Save, RefreshCw, Key, Zap, CheckCircle2, Eye, EyeOff, ShieldCheck, ExternalLink } from 'lucide-react';

export const SystemConfigsPage: React.FC = () => {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showFeishuSecret, setShowFeishuSecret] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getSystemConfigs();
      setConfigs(data);
      const m: Record<string, string> = {};
      data.forEach((c) => {
        m[c.key] = c.value;
      });
      setFormData(m);
    } catch (e: any) {
      alert('加载配置失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleChange = (key: string, val: string) => {
    setFormData((prev) => ({ ...prev, [key]: val }));
    setSavedSuccess(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedSuccess(false);
    try {
      await apiClient.updateSystemConfigs(formData);
      setSavedSuccess(true);
      loadData();
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      alert('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const getUpdatedAt = (key: string) => {
    const item = configs.find((c) => c.key === key);
    return item ? new Date(item.updated_at).toLocaleString('zh-CN') : '-';
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">系统全局配置 (System Configs)</h2>
          <p className="text-sm text-gray-500 mt-1">
            以列表表格形式维护全局大模型裁判凭证、默认调度并发数与网络请求超时时限
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 shadow-sm font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm font-medium disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {saving ? '正在保存...' : '保存全部配置'}
          </button>
        </div>
      </div>

      {savedSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          系统全局配置已成功保存并立即生效！
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* 表格 1: 大模型裁判全局配置 */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 bg-gray-100/70 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-purple-600" />
              <h3 className="font-bold text-gray-900 text-xs tracking-wider uppercase">
                全局大模型裁判 (LLM Judge) 凭证
              </h3>
            </div>
            <span className="text-[11px] text-gray-500">
              评测模块选择 LLM 裁判且未单独填写凭证时将默认复用以下设置
            </span>
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50 text-gray-500 font-semibold uppercase">
                <th className="py-2.5 px-5 w-56">配置项 (Key)</th>
                <th className="py-2.5 px-5 w-72">说明</th>
                <th className="py-2.5 px-5">配置值 (Value)</th>
                <th className="py-2.5 px-5 w-40">更新时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {/* judge_llm_base_url */}
              <tr className="hover:bg-blue-50/20 transition-colors">
                <td className="py-3.5 px-5">
                  <div className="font-bold text-gray-900">API Base URL</div>
                  <div className="font-mono text-[11px] text-gray-400">judge_llm_base_url</div>
                </td>
                <td className="py-3.5 px-5 text-gray-500">
                  兼容 OpenAI 协议的接口服务地址 (例如 https://api.openai.com/v1 或阿里云百炼/vLLM)
                </td>
                <td className="py-3.5 px-5">
                  <input
                    type="text"
                    value={formData['judge_llm_base_url'] || ''}
                    onChange={(e) => handleChange('judge_llm_base_url', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white"
                  />
                </td>
                <td className="py-3.5 px-5 text-gray-400 font-mono text-[11px]">
                  {getUpdatedAt('judge_llm_base_url')}
                </td>
              </tr>

              {/* judge_llm_api_key */}
              <tr className="hover:bg-blue-50/20 transition-colors">
                <td className="py-3.5 px-5">
                  <div className="font-bold text-gray-900">API Key 凭证</div>
                  <div className="font-mono text-[11px] text-gray-400">judge_llm_api_key</div>
                </td>
                <td className="py-3.5 px-5 text-gray-500">
                  大模型裁判鉴权密钥 (Bearer Token)，为空时评测器将采用降级语义比对
                </td>
                <td className="py-3.5 px-5">
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={formData['judge_llm_api_key'] || ''}
                      onChange={(e) => handleChange('judge_llm_api_key', e.target.value)}
                      placeholder="sk-..."
                      className="w-full pl-3 pr-9 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </td>
                <td className="py-3.5 px-5 text-gray-400 font-mono text-[11px]">
                  {getUpdatedAt('judge_llm_api_key')}
                </td>
              </tr>

              {/* judge_llm_model */}
              <tr className="hover:bg-blue-50/20 transition-colors">
                <td className="py-3.5 px-5">
                  <div className="font-bold text-gray-900">默认裁判模型名称</div>
                  <div className="font-mono text-[11px] text-gray-400">judge_llm_model</div>
                </td>
                <td className="py-3.5 px-5 text-gray-500">
                  用于进行综合质量判定的大模型名称 (例如 gpt-4o-mini, qwen-plus, deepseek-chat)
                </td>
                <td className="py-3.5 px-5">
                  <input
                    type="text"
                    value={formData['judge_llm_model'] || ''}
                    onChange={(e) => handleChange('judge_llm_model', e.target.value)}
                    placeholder="gpt-4o-mini"
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white"
                  />
                </td>
                <td className="py-3.5 px-5 text-gray-400 font-mono text-[11px]">
                  {getUpdatedAt('judge_llm_model')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 表格 2: 评测执行默认调度参数 */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 bg-gray-100/70 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-600" />
              <h3 className="font-bold text-gray-900 text-xs tracking-wider uppercase">
                评测执行调度默认参数
              </h3>
            </div>
            <span className="text-[11px] text-gray-500">
              控制沙箱批量请求并发峰值与网络超时熔断阈值
            </span>
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50 text-gray-500 font-semibold uppercase">
                <th className="py-2.5 px-5 w-56">配置项 (Key)</th>
                <th className="py-2.5 px-5 w-72">说明</th>
                <th className="py-2.5 px-5">配置值 (Value)</th>
                <th className="py-2.5 px-5 w-40">更新时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {/* default_concurrency */}
              <tr className="hover:bg-blue-50/20 transition-colors">
                <td className="py-3.5 px-5">
                  <div className="font-bold text-gray-900">默认调度并发数</div>
                  <div className="font-mono text-[11px] text-gray-400">default_concurrency</div>
                </td>
                <td className="py-3.5 px-5 text-gray-500">
                  批量调度时同时发起网络请求的 Goroutine Worker 数量 (推荐 1~10，防止被测 Agent 崩溃)
                </td>
                <td className="py-3.5 px-5">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={formData['default_concurrency'] || '3'}
                      onChange={(e) => handleChange('default_concurrency', e.target.value)}
                      className="w-32 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white"
                    />
                    <span className="text-gray-400 text-xs">个并发协程</span>
                  </div>
                </td>
                <td className="py-3.5 px-5 text-gray-400 font-mono text-[11px]">
                  {getUpdatedAt('default_concurrency')}
                </td>
              </tr>

              {/* default_timeout_seconds */}
              <tr className="hover:bg-blue-50/20 transition-colors">
                <td className="py-3.5 px-5">
                  <div className="font-bold text-gray-900">单用例默认网络超时</div>
                  <div className="font-mono text-[11px] text-gray-400">default_timeout_seconds</div>
                </td>
                <td className="py-3.5 px-5 text-gray-500">
                  单次场景脚本请求 Agent 的等待熔断上限，超时将自动标记为 ERROR 并阻断评估
                </td>
                <td className="py-3.5 px-5">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={formData['default_timeout_seconds'] || '30'}
                      onChange={(e) => handleChange('default_timeout_seconds', e.target.value)}
                      className="w-32 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white"
                    />
                    <span className="text-gray-400 text-xs">秒 (Seconds)</span>
                  </div>
                </td>
                <td className="py-3.5 px-5 text-gray-400 font-mono text-[11px]">
                  {getUpdatedAt('default_timeout_seconds')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 表格 3: 飞书单点登录配置 (Feishu SSO) */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 bg-gray-100/70 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <h3 className="font-bold text-gray-900 text-xs tracking-wider uppercase">
                飞书单点登录配置 (Feishu SSO)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${formData['feishu_sso_enabled'] === 'true' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {formData['feishu_sso_enabled'] === 'true' ? '● 飞书 SSO 已开启' : '○ 飞书 SSO 未开启'}
              </span>
            </div>
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50 text-gray-500 font-semibold uppercase">
                <th className="py-2.5 px-5 w-56">配置项 (Key)</th>
                <th className="py-2.5 px-5 w-72">说明</th>
                <th className="py-2.5 px-5">配置值 (Value)</th>
                <th className="py-2.5 px-5 w-40">更新时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {/* feishu_sso_enabled */}
              <tr className="hover:bg-blue-50/20 transition-colors">
                <td className="py-3.5 px-5">
                  <div className="font-bold text-gray-900">开启飞书单点登录</div>
                  <div className="font-mono text-[11px] text-gray-400">feishu_sso_enabled</div>
                </td>
                <td className="py-3.5 px-5 text-gray-500">
                  开启后强制全站身份验证，未登录用户访问受限，需通过飞书 OAuth 2.0 登录
                </td>
                <td className="py-3.5 px-5">
                  <select
                    value={formData['feishu_sso_enabled'] || 'false'}
                    onChange={(e) => handleChange('feishu_sso_enabled', e.target.value)}
                    className="w-44 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white"
                  >
                    <option value="false">停用 (未开启/免密体验)</option>
                    <option value="true">开启 (强制飞书 SSO 登录)</option>
                  </select>
                </td>
                <td className="py-3.5 px-5 text-gray-400 font-mono text-[11px]">
                  {getUpdatedAt('feishu_sso_enabled')}
                </td>
              </tr>

              {/* feishu_app_id */}
              <tr className="hover:bg-blue-50/20 transition-colors">
                <td className="py-3.5 px-5">
                  <div className="font-bold text-gray-900">飞书应用 App ID</div>
                  <div className="font-mono text-[11px] text-gray-400">feishu_app_id</div>
                </td>
                <td className="py-3.5 px-5 text-gray-500">
                  飞书开放平台自建应用的 App ID (格式通常为 <code className="font-mono text-blue-600">cli_xxxxxxxxxx</code>)
                </td>
                <td className="py-3.5 px-5">
                  <input
                    type="text"
                    value={formData['feishu_app_id'] || ''}
                    onChange={(e) => handleChange('feishu_app_id', e.target.value)}
                    placeholder="例如: cli_a1b2c3d4e5f67890"
                    className="w-full max-w-md px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white"
                  />
                </td>
                <td className="py-3.5 px-5 text-gray-400 font-mono text-[11px]">
                  {getUpdatedAt('feishu_app_id')}
                </td>
              </tr>

              {/* feishu_app_secret */}
              <tr className="hover:bg-blue-50/20 transition-colors">
                <td className="py-3.5 px-5">
                  <div className="font-bold text-gray-900">飞书应用 App Secret</div>
                  <div className="font-mono text-[11px] text-gray-400">feishu_app_secret</div>
                </td>
                <td className="py-3.5 px-5 text-gray-500">
                  飞书开放平台应用的密钥，用于后台向飞书换取 access_token (仅保存在本地 SQLite)
                </td>
                <td className="py-3.5 px-5">
                  <div className="flex items-center gap-2 max-w-md">
                    <input
                      type={showFeishuSecret ? 'text' : 'password'}
                      value={formData['feishu_app_secret'] || ''}
                      onChange={(e) => handleChange('feishu_app_secret', e.target.value)}
                      placeholder="例如: 3b9c4d5e6f7a8b9c0d1e2f3a"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowFeishuSecret(!showFeishuSecret)}
                      className="p-1.5 text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                      title={showFeishuSecret ? '隐藏密钥' : '显示密钥'}
                    >
                      {showFeishuSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </td>
                <td className="py-3.5 px-5 text-gray-400 font-mono text-[11px]">
                  {getUpdatedAt('feishu_app_secret')}
                </td>
              </tr>

              {/* feishu_redirect_uri */}
              <tr className="hover:bg-blue-50/20 transition-colors">
                <td className="py-3.5 px-5">
                  <div className="font-bold text-gray-900">飞书 OAuth 重定向回调地址</div>
                  <div className="font-mono text-[11px] text-gray-400">feishu_redirect_uri</div>
                </td>
                <td className="py-3.5 px-5 text-gray-500">
                  飞书授权通过后重定向的 API 回调地址，需与飞书开放平台中填写的重定向 URL 完全一致
                </td>
                <td className="py-3.5 px-5">
                  <input
                    type="text"
                    value={formData['feishu_redirect_uri'] || ''}
                    onChange={(e) => handleChange('feishu_redirect_uri', e.target.value)}
                    placeholder="留空自动使用当前站点: http://<你的域名或IP>:8080/api/v1/auth/feishu/callback"
                    className="w-full max-w-lg px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white"
                  />
                  <div className="text-[11px] text-gray-400 mt-1">
                    当前默认建议: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-600 font-mono">{window.location.origin}/api/v1/auth/feishu/callback</code>
                  </div>
                </td>
                <td className="py-3.5 px-5 text-gray-400 font-mono text-[11px]">
                  {getUpdatedAt('feishu_redirect_uri')}
                </td>
              </tr>
            </tbody>
          </table>

          {/* 飞书开放平台配置小贴士 */}
          <div className="px-5 py-3.5 bg-blue-50/40 border-t border-gray-200 text-xs text-slate-600 flex items-start gap-3">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-slate-800">飞书开放平台配置指引</div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                1. 登录 <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer" className="text-blue-600 underline font-medium inline-flex items-center gap-0.5">飞书开放平台 <ExternalLink className="w-2.5 h-2.5" /></a> 创建「企业自建应用」；<br />
                2. 在「应用功能 - 网页」中配置桌面端及移动端网页，将重定向 URL 添加为上方设置的「OAuth 回调地址」；<br />
                3. 在「开发配置 - 权限管理」中申请开通 <code className="bg-white px-1 py-0.5 rounded border border-blue-100 font-mono text-blue-700">contact:user.base:readonly</code> (获取用户基本信息)；<br />
                4. 在「版本管理与发布」中发布应用版本即可完成对接。
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1.5 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-xs shadow-sm disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {saving ? '正在保存...' : '保存全部系统配置'}
          </button>
        </div>
      </form>
    </div>
  );
};
