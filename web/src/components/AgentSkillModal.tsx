import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import {
  Download,
  Copy,
  Check,
  Terminal,
  Bot,
  ExternalLink,
  Sparkles,
  Key,
  Globe,
  X,
  FileCode,
  ShieldCheck,
} from 'lucide-react';

interface AgentSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AgentSkillModal: React.FC<AgentSkillModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<{ base_url: string; api_key: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      apiClient
        .getOpenAPIConfig()
        .then((res) => setConfig(res))
        .catch((err) => console.error('加载 OpenAPI 配置失败:', err))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const downloadUrl = '/api/v1/openapi/skill/download';
  const installCmd = `mkdir -p ~/.claude/skills/agent-eval && curl -sSL ${config?.base_url || 'http://localhost:8080'}${downloadUrl} | tar -xz -C ~/.claude/skills/agent-eval --strip-components=1`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 弹窗头部 */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base tracking-wide flex items-center gap-2">
                <span>编码 Agent 接入 (Skill 工具包)</span>
                <span className="text-[10px] bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 px-1.5 py-0.2 rounded font-mono">
                  Python 3 原生
                </span>
              </h3>
              <p className="text-xs text-slate-300">
                供 Claude Code、Cursor 等直接拉起评测、轮询进度与自优化 Prompt
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 弹窗内容区 */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-gray-700">
          {/* 一键下载卡片 */}
          <div className="p-4 bg-indigo-50/60 border border-indigo-100 rounded-xl flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="font-bold text-indigo-950 text-sm flex items-center gap-1.5">
                <FileCode className="w-4 h-4 text-indigo-600" />
                <span>离线安装包 (agent-eval-skill.tar.gz)</span>
              </div>
              <p className="text-gray-500 text-[11px]">
                包含 <code className="text-indigo-700 font-mono">eval_client.py</code> 脚本与{' '}
                <code className="text-indigo-700 font-mono">SKILL.md</code>，零第三方包依赖
              </p>
            </div>
            <a
              href={downloadUrl}
              download="agent-eval-skill.tar.gz"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Download className="w-4 h-4" />
              <span>下载 tar.gz 包</span>
            </a>
          </div>

          {/* 接入凭据 */}
          <div className="space-y-2">
            <span className="font-bold text-gray-800 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-indigo-600" />
              <span>OpenAPI 访问凭据</span>
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
              {/* Base URL */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-1">
                <div className="flex items-center justify-between text-gray-500 font-sans text-[10px]">
                  <span className="flex items-center gap-1">
                    <Globe className="w-3 h-3 text-gray-400" /> 服务地址 (Base URL)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (config?.base_url) {
                        navigator.clipboard.writeText(config.base_url);
                        setCopiedUrl(true);
                        setTimeout(() => setCopiedUrl(false), 1800);
                      }
                    }}
                    className="text-blue-600 hover:text-blue-800 flex items-center gap-0.5 font-medium"
                  >
                    {copiedUrl ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedUrl ? '已复制' : '复制'}</span>
                  </button>
                </div>
                <div className="text-gray-900 font-semibold truncate select-all">
                  {config?.base_url || 'http://localhost:8080'}
                </div>
              </div>

              {/* API Key */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-1">
                <div className="flex items-center justify-between text-gray-500 font-sans text-[10px]">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-600" /> 长效 API Key (本地免配)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (config?.api_key) {
                        navigator.clipboard.writeText(config.api_key);
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 1800);
                      }
                    }}
                    className="text-blue-600 hover:text-blue-800 flex items-center gap-0.5 font-medium"
                  >
                    {copiedKey ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey ? '已复制' : '复制'}</span>
                  </button>
                </div>
                <div className="text-gray-900 font-semibold truncate select-all" title={config?.api_key}>
                  {config?.api_key || '正在获取...'}
                </div>
              </div>
            </div>
            <p className="text-[10px] text-gray-400">
              * 鉴权规则：本地回环访问（127.0.0.1 / localhost）免鉴权自动放行；远程机器调用请配置 Header{' '}
              <code className="text-gray-600">X-API-Key: {config?.api_key || '...'}</code>
            </p>
          </div>

          {/* Claude Code 极速配置指引 */}
          <div className="space-y-2">
            <span className="font-bold text-gray-800 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-blue-600" />
              <span>极速配置与使用 (以 Claude Code 为例)</span>
            </span>

            <div className="bg-slate-900 text-slate-200 p-3.5 rounded-xl font-mono text-[11px] space-y-2.5">
              <div>
                <div className="text-slate-400 text-[10px] mb-1 font-sans flex items-center justify-between">
                  <span>1. 终端一键解压安装到 Claude Code 全局 Skill:</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(installCmd);
                      setCopiedInstall(true);
                      setTimeout(() => setCopiedInstall(false), 1800);
                    }}
                    className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 text-[10px]"
                  >
                    {copiedInstall ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedInstall ? '已复制' : '复制命令'}</span>
                  </button>
                </div>
                <pre className="p-2 bg-slate-950 rounded border border-slate-800 whitespace-pre-wrap break-all text-emerald-400">
                  {installCmd}
                </pre>
              </div>

              <div>
                <div className="text-slate-400 text-[10px] mb-1 font-sans">
                  2. 在 Claude Code 会话中直接下达自优化指令:
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800 text-indigo-200 space-y-1">
                  <p>💬 "运行评测任务 #2，根据评测报告中的失败案例与裁判反馈优化当前提示词"</p>
                  <p>💬 "改好后运行 --failed-only 快速复测验证刚才失败的用例是否已通过"</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 弹窗底部 */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
          <span className="text-[11px] text-gray-400 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>支持全量运行、--limit 快速抽样及 --failed-only 精准回归</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
