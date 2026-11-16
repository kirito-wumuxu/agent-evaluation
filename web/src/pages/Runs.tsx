import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { RunRecord } from '../types';
import { RefreshCw, Trash2, ArrowRight, Activity, Clock } from 'lucide-react';
import { RunDetailPage } from './RunDetail';

interface RunsPageProps {
  initialSelectedRunId?: number | null;
}

export const RunsPage: React.FC<RunsPageProps> = ({ initialSelectedRunId }) => {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(initialSelectedRunId || null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getRuns();
      setRuns(data);
    } catch (e: any) {
      alert('加载运行记录失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      apiClient.getRuns().then(setRuns).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm('确定要删除该运行记录吗？')) return;
    try {
      await apiClient.deleteRun(id);
      if (selectedRunId === id) setSelectedRunId(null);
      loadData();
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
  };

  if (selectedRunId !== null) {
    return <RunDetailPage runId={selectedRunId} onBack={() => setSelectedRunId(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">运行记录与人工复核 (Runs & Review)</h2>
          <p className="text-sm text-gray-500 mt-1">
            列表化监控评测执行批次、实时状态、机器自动化评分与质检双轨复核看板
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 shadow-sm font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新记录
          </button>
        </div>
      </div>

      {/* 列表表格展示 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4 w-14 text-center">批次ID</th>
              <th className="py-3 px-4 w-48">评测任务名称</th>
              <th className="py-3 px-4 w-28 text-center">状态</th>
              <th className="py-3 px-4 w-36">用例执行进度</th>
              <th className="py-3 px-4 w-40 text-center">机器评测均分 (通过率)</th>
              <th className="py-3 px-4 w-40 text-center">人工复核进度 (均分)</th>
              <th className="py-3 px-4 w-36">执行时间</th>
              <th className="py-3 px-4 w-36 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {runs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-20 text-center text-gray-400">
                  <Activity className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  暂无评测运行记录，请在「评测任务」页面点击“运行”
                </td>
              </tr>
            ) : (
              runs.map((r) => {
                const progressPct =
                  r.total_count > 0 ? Math.round(((r.success_count + r.error_count) / r.total_count) * 100) : 0;
                const machinePassRate =
                  r.total_count > 0 ? Math.round((r.machine_pass_count / r.total_count) * 100) : 0;
                const isRunning = r.status === 'RUNNING' || r.status === 'PENDING';

                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedRunId(r.id)}
                    className="hover:bg-blue-50/40 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-4 text-center font-mono font-bold text-gray-400">#{r.id}</td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-gray-900 text-xs">
                        {r.task?.name || `评测任务 ID #${r.task_id}`}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {r.task?.scenario?.name} • {r.task?.environment?.name}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`px-2 py-0.5 text-[11px] font-medium rounded border ${
                          r.status === 'COMPLETED'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : isRunning
                            ? 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse'
                            : r.status === 'FAILED'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-gray-50 text-gray-700 border-gray-200'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-xs font-medium text-gray-700">
                        {r.success_count} 成功 / {r.total_count} 总数
                        {r.error_count > 0 && <span className="text-rose-600 font-semibold ml-1">({r.error_count}异常)</span>}
                      </div>
                      {isRunning && (
                        <div className="w-full bg-gray-100 rounded-full h-1 mt-1 overflow-hidden">
                          <div className="bg-blue-600 h-1 rounded-full" style={{ width: `${progressPct}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="font-semibold text-gray-900 text-sm">{r.machine_avg_score.toFixed(1)}</span>
                      <span className="text-[10px] text-gray-400 ml-1">分</span>
                      <span className="block text-[10px] text-gray-500">通过率: {machinePassRate}%</span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="text-xs font-semibold text-gray-800">
                        {r.reviewed_count} / {r.total_count}
                      </div>
                      <span className="text-[10px] text-gray-500 block">
                        {r.reviewed_count > 0 ? `复核均分: ${r.human_avg_score.toFixed(1)}分` : '待复核'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-gray-400 text-xs">
                      {new Date(r.created_at).toLocaleTimeString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setSelectedRunId(r.id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded"
                        >
                          查看与复核 <ArrowRight className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, r.id)}
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
    </div>
  );
};
