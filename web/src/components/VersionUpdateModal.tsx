import React, { useState } from 'react';
import { apiClient } from '../api/client';
import { SystemVersionInfo, User } from '../types';
import {
  Sparkles,
  RefreshCw,
  ArrowUpCircle,
  CheckCircle2,
  AlertCircle,
  Terminal,
  ExternalLink,
  Clock,
  GitCommit,
  X,
  ShieldAlert,
  Download,
} from 'lucide-react';

interface VersionUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  versionInfo: SystemVersionInfo | null;
  onVersionUpdated: (info: SystemVersionInfo) => void;
  currentUser?: User | null;
}

export const VersionUpdateModal: React.FC<VersionUpdateModalProps> = ({
  isOpen,
  onClose,
  versionInfo,
  onVersionUpdated,
  currentUser,
}) => {
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [updateError, setUpdateError] = useState('');

  if (!isOpen) return null;

  const isAdmin = currentUser?.role === 'admin';

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateError('');
    try {
      const res = await apiClient.checkSystemUpdate();
      onVersionUpdated(res);
    } catch (e: any) {
      setUpdateError(e.response?.data?.message || e.message || '检查更新失败');
    } finally {
      setChecking(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!isAdmin) {
      alert('抱歉，仅管理员 (admin) 具备执行服务端软件更新的权限');
      return;
    }
    if (!confirm(`确定要将系统从 ${versionInfo?.current_version} 自动更新至最新版本 ${versionInfo?.latest_version} 吗？\n更新过程将下载对应平台的独立二进制包并自动重载服务。`)) {
      return;
    }

    setUpdating(true);
    setUpdateError('');
    try {
      await apiClient.applySystemUpdate({
        asset_url: versionInfo?.asset_url,
      });
      setUpdateSuccess(true);
      // 倒计时后自动刷新页面
      let count = 5;
      setCountdown(count);
      const timer = setInterval(() => {
        count--;
        setCountdown(count);
        if (count <= 0) {
          clearInterval(timer);
          window.location.reload();
        }
      }, 1000);
    } catch (e: any) {
      setUpdateError(e.response?.data?.message || e.message || '自更新执行失败');
      setUpdating(false);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes > 1024 * 1024) {
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    return Math.round(bytes / 1024) + ' KB';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 头部 */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base tracking-wide flex items-center gap-2">
                <span>软件版本与在线自更新</span>
                <span className="text-[10px] bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 px-1.5 py-0.2 rounded font-mono">
                  GitHub Releases
                </span>
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">跨平台单二进制无缝升级与版本检查</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 身体内容 */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {/* 版本对比卡片 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
              <span className="text-gray-500 font-medium block mb-1">当前运行版本</span>
              <div className="text-lg font-bold text-gray-900 font-mono flex items-center gap-2">
                <span>{versionInfo?.current_version || 'dev'}</span>
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-gray-400 font-mono">
                <div className="flex items-center gap-1">
                  <GitCommit className="w-3 h-3" /> Commit: {versionInfo?.git_commit?.slice(0, 8) || 'none'}
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> 构建: {versionInfo?.build_time || '未知'}
                </div>
              </div>
            </div>

            <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl flex flex-col justify-between">
              <div>
                <span className="text-indigo-600 font-medium block mb-1">GitHub 最新版本</span>
                <div className="text-lg font-bold text-indigo-950 font-mono">
                  {versionInfo?.latest_version || '检查中...'}
                </div>
                {versionInfo?.published_at && (
                  <div className="text-[11px] text-indigo-400 mt-1">
                    发布于: {new Date(versionInfo.published_at).toLocaleDateString('zh-CN')}
                  </div>
                )}
              </div>

              <div className="mt-3">
                {versionInfo?.has_update ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold border border-amber-200">
                    <ArrowUpCircle className="w-3 h-3" /> 发现新版本可用
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3" /> 当前已是最新版
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 错误提示 */}
          {updateError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{updateError}</span>
            </div>
          )}

          {/* 更新成功提示 */}
          {updateSuccess && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl space-y-2">
              <div className="font-bold flex items-center gap-1.5 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                软件更新已完成！
              </div>
              <p className="text-xs text-emerald-700 leading-relaxed">
                新版本单二进制程序已替换完成，服务正在后台重启生效中。
                <br />
                网页将在 <b className="font-mono text-emerald-900">{countdown}</b> 秒后自动重载刷新...
              </p>
            </div>
          )}

          {/* 更新日志与发布说明 */}
          {versionInfo?.release_notes && (
            <div className="space-y-2">
              <div className="font-semibold text-gray-700 flex items-center justify-between">
                <span>版本更新说明 (Release Notes)</span>
                {versionInfo?.latest_version && (
                  <a
                    href={`https://github.com/kirito-wumuxu/agent-evaluation/releases/tag/${versionInfo.latest_version}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 hover:text-indigo-700 flex items-center gap-1 font-normal text-[11px]"
                  >
                    <span>在 GitHub 查看</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl max-h-48 overflow-y-auto font-mono text-[11px] text-gray-700 whitespace-pre-wrap leading-relaxed">
                {versionInfo.release_notes}
              </div>
            </div>
          )}

          {/* 资产与构建信息 */}
          {versionInfo?.asset_name && (
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-[11px] text-gray-400 block">目标系统适配构建包:</span>
                <span className="font-mono font-semibold text-gray-800">{versionInfo.asset_name}</span>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-gray-400 block">包大小:</span>
                <span className="font-mono text-gray-700">{formatSize(versionInfo.asset_size)}</span>
              </div>
            </div>
          )}

          {/* 权限提示 */}
          {!isAdmin && (
            <div className="p-2.5 bg-amber-50/70 border border-amber-200/80 text-amber-800 rounded-lg flex items-center gap-2 text-[11px]">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>当前登录账号非管理员，仅可查看更新信息。如需执行软件升级请使用管理员账号或命令行 `agent-eval-server --update`。</span>
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <button
            type="button"
            onClick={handleCheckUpdate}
            disabled={checking || updating}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-gray-300 hover:bg-white text-gray-700 font-medium text-xs shadow-2xs transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? '正在检查...' : '检查更新'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={updating}
              className="px-3.5 py-1.5 rounded-lg text-gray-600 hover:bg-gray-200 text-xs transition-colors"
            >
              关闭
            </button>

            {versionInfo?.has_update && (
              <button
                type="button"
                onClick={handleApplyUpdate}
                disabled={updating || updateSuccess || !isAdmin}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title={!isAdmin ? '仅管理员具备软件升级权限' : '点击下载并原子替换为新版本二进制'}
              >
                {updating ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>正在下载与热更新...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>立即自动更新至 {versionInfo.latest_version}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
