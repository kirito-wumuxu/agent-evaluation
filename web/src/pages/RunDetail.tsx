import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { RunRecord, RunRecordItem, EvaluatorDetail } from '../types';
import {
  ArrowLeft,
  RefreshCw,
  RotateCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  UserCheck,
  Cpu,
  Edit2,
  ChevronDown,
  ChevronUp,
  Table,
  Code2,
} from 'lucide-react';

interface RunDetailProps {
  runId: number;
  onBack: () => void;
}

export const RunDetailPage: React.FC<RunDetailProps> = ({ runId, onBack }) => {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [items, setItems] = useState<RunRecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'error' | 'machine_failed' | 'unreviewed'>('all');
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [detailItem, setDetailItem] = useState<RunRecordItem | null>(null);

  // 人工复核弹窗
  const [reviewItem, setReviewItem] = useState<RunRecordItem | null>(null);
  const [reviewScore, setReviewScore] = useState<number>(100);
  const [reviewPassed, setReviewPassed] = useState<boolean>(true);
  const [reviewComment, setReviewComment] = useState<string>('');
  const [reviewerName, setReviewerName] = useState<string>('质检员');
  const [savingReview, setSavingReview] = useState(false);
  const [compareMode, setCompareMode] = useState<'table' | 'raw'>('table');

  // 重新评测状态
  const [reevaluatingAll, setReevaluatingAll] = useState(false);
  const [reevaluatingItemId, setReevaluatingItemId] = useState<number | null>(null);

  const handleReevaluateAll = async () => {
    if (!confirm('确定要从用例集同步最新用例数据（输入/期望输出），并对该批次所有用例重新执行评测器打分吗？')) {
      return;
    }
    setReevaluatingAll(true);
    try {
      const res = await apiClient.reevaluateRun(runId);
      alert(`全量重新评测完成！共重新评估 ${res.updated_count} 条用例。`);
      await loadData();
    } catch (e: any) {
      alert('全量重新评测失败: ' + (e.response?.data?.message || e.message));
    } finally {
      setReevaluatingAll(false);
    }
  };

  const handleReevaluateItem = async (item: RunRecordItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setReevaluatingItemId(item.id);
    try {
      const res = await apiClient.reevaluateRunItem(runId, item.id);
      if (detailItem && detailItem.id === item.id) {
        setDetailItem(res.item);
      }
      await loadData();
    } catch (e: any) {
      alert('用例重新评测失败: ' + (e.response?.data?.message || e.message));
    } finally {
      setReevaluatingItemId(null);
    }
  };

  const formatJsonStr = (raw: string) => {
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return JSON.stringify(parsed, null, 2);
      }
    } catch {}
    return raw;
  };

  // 尝试将字符串解析为非数组的 JSON 对象
  const parseJsonObject = (raw: string): Record<string, any> | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
    return null;
  };

  // 计算字符串相似度 (Bigram Sorensen-Dice)
  const calculateSimilarity = (str1: string, str2: string): number => {
    if (!str1 || !str2) return 0;
    const s1 = str1.trim();
    const s2 = str2.trim();
    if (s1 === s2) return 1;
    if (s1.length <= 1 || s2.length <= 1) {
      return s1.includes(s2) || s2.includes(s1) ? 0.6 : 0;
    }
    const bg1 = new Map<string, number>();
    for (let i = 0; i < s1.length - 1; i++) {
      const b = s1.slice(i, i + 2);
      bg1.set(b, (bg1.get(b) || 0) + 1);
    }
    const bg2 = new Map<string, number>();
    for (let i = 0; i < s2.length - 1; i++) {
      const b = s2.slice(i, i + 2);
      bg2.set(b, (bg2.get(b) || 0) + 1);
    }
    let intersection = 0;
    for (const [b, count1] of bg1.entries()) {
      const count2 = bg2.get(b) || 0;
      intersection += Math.min(count1, count2);
    }
    const total = (s1.length - 1) + (s2.length - 1);
    return total > 0 ? (2 * intersection) / total : 0;
  };

  interface FieldRow {
    key: string;
    label?: string;
    expectedStr: string;
    actualStr: string;
    score: number;
    status: 'match' | 'partial' | 'mismatch' | 'missing';
    statusText: string;
  }

  const computeFieldComparison = (
    key: string,
    expVal: any,
    actVal: any,
    labelMap: Record<string, string>
  ): FieldRow => {
    const hasExp = expVal !== undefined && expVal !== null && expVal !== '';
    const hasAct = actVal !== undefined && actVal !== null && actVal !== '';

    const expStr = expVal !== undefined && expVal !== null
      ? (typeof expVal === 'object' ? JSON.stringify(expVal) : String(expVal))
      : '';
    const actStr = actVal !== undefined && actVal !== null
      ? (typeof actVal === 'object' ? JSON.stringify(actVal) : String(actVal))
      : '';

    const label = labelMap[key] || undefined;

    if (!hasExp && !hasAct) {
      return {
        key,
        label,
        expectedStr: expStr,
        actualStr: actStr,
        score: 100,
        status: 'match',
        statusText: '一致',
      };
    }

    if (hasExp && !hasAct) {
      return {
        key,
        label,
        expectedStr: expStr,
        actualStr: '',
        score: 0,
        status: 'missing',
        statusText: '缺失',
      };
    }

    if (!hasExp && hasAct) {
      return {
        key,
        label,
        expectedStr: '',
        actualStr: actStr,
        score: 0,
        status: 'mismatch',
        statusText: '多余字段',
      };
    }

    const expTrim = expStr.trim();
    const actTrim = actStr.trim();

    if (expTrim === actTrim) {
      return {
        key,
        label,
        expectedStr: expStr,
        actualStr: actStr,
        score: 100,
        status: 'match',
        statusText: '一致',
      };
    }

    if (expTrim.toLowerCase() === actTrim.toLowerCase()) {
      return {
        key,
        label,
        expectedStr: expStr,
        actualStr: actStr,
        score: 95,
        status: 'match',
        statusText: '大小写一致',
      };
    }

    if (actTrim.includes(expTrim) || expTrim.includes(actTrim)) {
      const ratio = Math.min(expTrim.length, actTrim.length) / Math.max(expTrim.length, actTrim.length);
      const score = Math.round(70 + ratio * 20);
      return {
        key,
        label,
        expectedStr: expStr,
        actualStr: actStr,
        score,
        status: 'partial',
        statusText: `部分包含 (${score}分)`,
      };
    }

    const sim = calculateSimilarity(expTrim, actTrim);
    const score = Math.round(sim * 100);
    if (score >= 60) {
      return {
        key,
        label,
        expectedStr: expStr,
        actualStr: actStr,
        score,
        status: 'partial',
        statusText: `相似度 ${score}%`,
      };
    }

    return {
      key,
      label,
      expectedStr: expStr,
      actualStr: actStr,
      score,
      status: 'mismatch',
      statusText: '不一致',
    };
  };

  const getColLabelMap = (): Record<string, string> => {
    const map: Record<string, string> = {};
    try {
      const colsJson = run?.task?.dataset?.columns_json;
      if (colsJson) {
        const parsed = JSON.parse(colsJson);
        if (Array.isArray(parsed)) {
          parsed.forEach((c: any) => {
            if (c.key && c.label) {
              map[c.key] = c.label;
            }
          });
        }
      }
    } catch {}
    return map;
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const runData = await apiClient.getRun(runId);
      setRun(runData);

      let params: any = {};
      if (filter === 'error') params.status = 'ERROR';
      if (filter === 'machine_failed') params.machine_passed = 'false';
      if (filter === 'unreviewed') params.reviewed = 'false';

      const itemsData = await apiClient.getRunItems(runId, params);
      setItems(itemsData);
    } catch (e: any) {
      alert('加载明细失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // 如果任务处于运行中，自动轮询刷新
    let interval: any;
    if (run?.status === 'RUNNING' || run?.status === 'PENDING') {
      interval = setInterval(loadData, 2000);
    }
    return () => clearInterval(interval);
  }, [runId, filter, run?.status]);

  const openReviewModal = (item: RunRecordItem) => {
    setReviewItem(item);
    setReviewScore(item.human_score !== null && item.human_score !== undefined ? item.human_score : item.machine_score);
    setReviewPassed(item.human_passed !== null && item.human_passed !== undefined ? item.human_passed : item.machine_passed);
    const defaultReviewer = item.reviewer_name || localStorage.getItem('eval_user_name') || '质检员';
    setReviewerName(defaultReviewer);
  };

  const handleSaveReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewItem) return;
    setSavingReview(true);
    try {
      await apiClient.reviewRunItem(runId, reviewItem.id, {
        human_score: Number(reviewScore),
        human_passed: reviewPassed,
        human_comment: reviewComment,
        reviewer_name: reviewerName,
      });
      if (detailItem && detailItem.id === reviewItem.id) {
        setDetailItem({
          ...detailItem,
          human_score: Number(reviewScore),
          human_passed: reviewPassed,
          human_comment: reviewComment,
          reviewer_name: reviewerName,
          reviewed_at: new Date().toISOString(),
        });
      }
      setReviewItem(null);
      loadData();
    } catch (err: any) {
      alert('保存复核失败: ' + err.message);
    } finally {
      setSavingReview(false);
    }
  };

  if (!run) {
    return <div className="text-center py-20 text-gray-500">正在加载运行记录...</div>;
  }

  const machinePassRate = run.total_count > 0 ? Math.round((run.machine_pass_count / run.total_count) * 100) : 0;
  const humanPassRate = run.reviewed_count > 0 ? Math.round((run.human_pass_count / run.reviewed_count) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* 顶部返回与导航 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> 返回运行记录列表
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReevaluateAll}
            disabled={reevaluatingAll || loading || run.status === 'RUNNING'}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm font-medium transition-colors disabled:opacity-50"
            title="从用例集同步最新数据并对本批次全量用例重新评测打分"
          >
            <RotateCw className={`w-4 h-4 ${reevaluatingAll ? 'animate-spin' : ''}`} />
            {reevaluatingAll ? '正在重新评测...' : '更新用例重新评测 (全量)'}
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 shadow-sm font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新明细
          </button>
        </div>
      </div>

      {/* 任务指标概览卡片 */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900">
                运行记录 #{run.id} : {run.task?.name || `任务ID #${run.task_id}`}
              </h2>
              <span
                className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                  run.status === 'COMPLETED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : run.status === 'RUNNING'
                    ? 'bg-blue-100 text-blue-800 animate-pulse'
                    : run.status === 'FAILED'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {run.status}
              </span>
            </div>
            <div className="text-xs text-gray-500 mt-1 flex items-center gap-4">
              <span>场景: {run.task?.scenario?.name}</span>
              <span>环境: {run.task?.environment?.name}</span>
              <span>用例集: {run.task?.dataset?.name}</span>
              <span>耗时: {run.started_at && run.finished_at ? `${Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)} 秒` : '-'}</span>
            </div>
          </div>
        </div>

        {/* 机器评测 vs 人工复核 双轨核心指标 */}
        <div className="grid grid-cols-2 gap-4 mt-6 pt-5 border-t border-gray-100">
          {/* 机器评估卡片 */}
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                <Cpu className="w-3.5 h-3.5 text-blue-600" />
                机器评测
              </div>
              <div className="mt-1.5 flex items-baseline gap-2.5">
                <div className="text-xl font-bold text-gray-900">{run.machine_avg_score.toFixed(1)} 分</div>
                <div className="text-xs text-gray-500">通过率: <span className="font-semibold text-gray-800">{machinePassRate}%</span> ({run.machine_pass_count}/{run.total_count})</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-gray-400">成功 / 异常</div>
              <div className="text-xs font-semibold text-gray-700">{run.success_count} / {run.error_count}</div>
            </div>
          </div>

          {/* 人工复核卡片 */}
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                <UserCheck className="w-3.5 h-3.5 text-gray-700" />
                人工复核
              </div>
              <div className="mt-1.5 flex items-baseline gap-2.5">
                <div className="text-xl font-bold text-gray-900">
                  {run.reviewed_count > 0 ? `${run.human_avg_score.toFixed(1)} 分` : '待复核'}
                </div>
                <div className="text-xs text-gray-500">
                  复核通过率: <span className="font-semibold text-gray-800">{humanPassRate}%</span> ({run.human_pass_count}/{run.reviewed_count || 1})
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-gray-400">已复核进度</div>
              <div className="text-xs font-semibold text-gray-700">{run.reviewed_count} / {run.total_count}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 筛选标签栏 */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${
            filter === 'all' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          全部 ({run.total_count})
        </button>
        <button
          onClick={() => setFilter('unreviewed')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${
            filter === 'unreviewed' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          待复核 ({run.total_count - run.reviewed_count})
        </button>
        <button
          onClick={() => setFilter('machine_failed')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${
            filter === 'machine_failed' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          未通过 ({run.total_count - run.machine_pass_count})
        </button>
        <button
          onClick={() => setFilter('error')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${
            filter === 'error' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          异常 ({run.error_count})
        </button>
      </div>

      {/* 单行用例记录列表 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center">#</th>
              <th className="py-3 px-4 min-w-[260px]">用例输入 (Input)</th>
              <th className="py-3 px-4 w-24 text-center">耗时</th>
              <th className="py-3 px-4 w-28 text-center">执行状态</th>
              <th className="py-3 px-4 w-36 text-center">机器评测</th>
              <th className="py-3 px-4 w-44 text-center">人工复核</th>
              <th className="py-3 px-4 w-36 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-gray-400">
                  暂无符合条件的用例记录
                </td>
              </tr>
            ) : (
              items.map((item, idx) => (
                <tr
                  key={item.id}
                  onClick={() => setDetailItem(item)}
                  className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                >
                  <td className="py-3 px-4 text-center font-mono text-gray-400 select-none">
                    {idx + 1}
                  </td>
                  <td className="py-3 px-4 max-w-md">
                    <div className="truncate font-mono text-gray-800" title={item.input_data}>
                      {item.input_data}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-gray-500 whitespace-nowrap">
                    {item.latency_ms} ms
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    {item.status === 'COMPLETED' ? (
                      <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 rounded-full inline-flex items-center gap-1 border border-emerald-100">
                        <CheckCircle2 className="w-3 h-3" /> 完成
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[11px] font-semibold bg-rose-50 text-rose-700 rounded-full inline-flex items-center gap-1 border border-rose-100">
                        <AlertTriangle className="w-3 h-3" /> 异常
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    <span className="font-semibold text-gray-900 mr-1.5">{item.machine_score}分</span>
                    {item.machine_passed ? (
                      <span className="px-1.5 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium rounded">
                        通过
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[10px] bg-rose-50 text-rose-700 border border-rose-200 font-medium rounded">
                        未过
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    {item.reviewed_at ? (
                      <div className="inline-flex items-center gap-1.5 text-gray-700 text-xs">
                        <span className="font-semibold text-gray-900">{item.human_score}分</span>
                        {item.human_passed ? (
                          <span className="text-[10px] px-1 py-0.2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded font-medium">通过</span>
                        ) : (
                          <span className="text-[10px] px-1 py-0.2 bg-rose-50 text-rose-700 border border-rose-200 rounded font-medium">未过</span>
                        )}
                        <span className="text-[10px] text-gray-400">({item.reviewer_name})</span>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">未复核</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={(e) => handleReevaluateItem(item, e)}
                        disabled={reevaluatingItemId === item.id}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded transition-colors disabled:opacity-50"
                        title="从用例集同步最新期望并重新评测该用例"
                      >
                        <RotateCw className={`w-3 h-3 ${reevaluatingItemId === item.id ? 'animate-spin' : ''}`} />
                        {reevaluatingItemId === item.id ? '评测中...' : '重新评测'}
                      </button>
                      <button
                        onClick={() => setDetailItem(item)}
                        className="px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      >
                        查看详情
                      </button>
                      <button
                        onClick={() => openReviewModal(item)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded transition-colors"
                      >
                        <Edit2 className="w-3 h-3" /> {item.reviewed_at ? '改评' : '复核'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 用例详情对比弹窗：期望值与实际值上下放置宽幅对比 */}
      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* 弹窗头部 */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-gray-800">
                  用例详情 #{detailItem.id}
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  (TestCase ID: #{detailItem.test_case_id})
                </span>
                {detailItem.status === 'COMPLETED' ? (
                  <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-full flex items-center gap-1 border border-emerald-100">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 正常完成
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-xs font-semibold bg-rose-50 text-rose-700 rounded-full flex items-center gap-1 border border-rose-100">
                    <AlertTriangle className="w-3.5 h-3.5" /> 执行异常
                  </span>
                )}
                <span className="text-xs text-gray-400 flex items-center gap-1 font-mono">
                  <Clock className="w-3 h-3" /> {detailItem.latency_ms} ms
                </span>
              </div>
              <button
                onClick={() => setDetailItem(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none p-1"
                title="关闭"
              >
                ×
              </button>
            </div>

            {/* 弹窗主体内容 */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* 1. 用例输入 (Input) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-700">
                    用例输入 (Input)
                  </span>
                </div>
                <pre className="p-3 bg-gray-50/70 rounded-lg border border-gray-200 font-mono text-xs text-gray-800 whitespace-pre-wrap max-h-36 overflow-y-auto">
                  {formatJsonStr(detailItem.input_data)}
                </pre>
              </div>

              {/* 2. 核心上下对比区：期望标准输出 与 实际输出 对比 */}
              {(() => {
                const expObj = parseJsonObject(detailItem.expected_output);
                const actObj = parseJsonObject(detailItem.actual_output);
                const isStructured = Boolean(expObj || actObj);

                const labelMap = getColLabelMap();
                const allKeys = Array.from(
                  new Set([
                    ...Object.keys(expObj || {}),
                    ...Object.keys(actObj || {}),
                  ])
                );
                const comparisonRows = allKeys.map((k) =>
                  computeFieldComparison(k, expObj ? expObj[k] : undefined, actObj ? actObj[k] : undefined, labelMap)
                );
                const matchCount = comparisonRows.filter((r) => r.status === 'match').length;
                const diffCount = comparisonRows.length - matchCount;
                const avgScore =
                  comparisonRows.length > 0
                    ? (comparisonRows.reduce((acc, r) => acc + r.score, 0) / comparisonRows.length).toFixed(1)
                    : '0.0';

                return (
                  <div className="space-y-3 p-4 bg-gray-50/40 border border-gray-200 rounded-lg">
                    <div className="text-xs font-semibold text-gray-900 border-b border-gray-200 pb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>期望标准输出 (Expected) 与 实际输出 (Actual) 对比</span>
                        <span className="text-[11px] text-gray-400 font-normal">
                          {isStructured ? '支持按字段结构化对比与原始文本切换' : '上下对齐便于比对'}
                        </span>
                      </div>
                      {isStructured && (
                        <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-md border border-gray-200">
                          <button
                            type="button"
                            onClick={() => setCompareMode('table')}
                            className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                              compareMode === 'table'
                                ? 'bg-white text-gray-900 font-semibold shadow-xs'
                                : 'text-gray-500 hover:text-gray-800'
                            }`}
                          >
                            <Table className="w-3 h-3" />
                            <span>按字段比对表格</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCompareMode('raw')}
                            className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                              compareMode === 'raw'
                                ? 'bg-white text-gray-900 font-semibold shadow-xs'
                                : 'text-gray-500 hover:text-gray-800'
                            }`}
                          >
                            <Code2 className="w-3 h-3" />
                            <span>原始文本对比</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {isStructured && compareMode === 'table' ? (
                      <div className="space-y-2.5">
                        {/* 统计指标栏 */}
                        <div className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-gray-200 text-xs">
                          <div className="flex items-center gap-3 text-gray-600">
                            <span>
                              比对字段: <strong className="text-gray-900 font-mono">{comparisonRows.length}</strong> 项
                            </span>
                            <span className="text-gray-300">|</span>
                            <span>
                              完全一致: <strong className="text-emerald-700 font-mono">{matchCount}</strong>
                            </span>
                            <span className="text-gray-300">|</span>
                            <span>
                              差异/部分: <strong className={diffCount > 0 ? 'text-amber-700 font-mono' : 'text-gray-700 font-mono'}>{diffCount}</strong>
                            </span>
                          </div>
                          <div className="text-gray-600">
                            字段匹配均分: <span className="font-semibold text-gray-900 text-sm ml-1">{avgScore}</span> 分
                          </div>
                        </div>

                        {/* 结构化字段对比表格 */}
                        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-xs">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-600 font-semibold">
                                <th className="py-2.5 px-3 w-44 min-w-[140px]">字段名</th>
                                <th className="py-2.5 px-3 min-w-[200px]">期望值</th>
                                <th className="py-2.5 px-3 min-w-[200px]">实际值</th>
                                <th className="py-2.5 px-3 w-32 text-center">评分</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 text-gray-800">
                              {comparisonRows.map((row) => (
                                <tr
                                  key={row.key}
                                  className={`transition-colors ${
                                    row.status === 'match'
                                      ? 'hover:bg-emerald-50/20'
                                      : row.status === 'partial'
                                      ? 'bg-amber-50/20 hover:bg-amber-50/40'
                                      : 'bg-rose-50/20 hover:bg-rose-50/30'
                                  }`}
                                >
                                  <td className="py-2.5 px-3 align-top font-mono">
                                    {row.label ? (
                                      <div>
                                        <div className="font-semibold text-gray-900">{row.label}</div>
                                        <div className="text-[10px] text-gray-400 font-mono">{row.key}</div>
                                      </div>
                                    ) : (
                                      <span className="font-semibold text-gray-900">{row.key}</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 align-top font-mono whitespace-pre-wrap break-all text-xs bg-gray-50/50 text-gray-800">
                                    {row.expectedStr || <span className="text-gray-300 italic">-</span>}
                                  </td>
                                  <td className="py-2.5 px-3 align-top font-mono whitespace-pre-wrap break-all text-xs">
                                    {row.status === 'missing' ? (
                                      <span className="text-rose-500 italic">缺失 (未输出该字段)</span>
                                    ) : (
                                      <span className={row.status === 'match' ? 'text-gray-900' : 'text-rose-950 font-medium'}>
                                        {row.actualStr || <span className="text-gray-300 italic">-</span>}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 align-top text-center whitespace-nowrap">
                                    <div className="inline-flex flex-col items-center gap-1">
                                      <span
                                        className={`font-semibold text-xs ${
                                          row.score === 100
                                            ? 'text-emerald-700'
                                            : row.score >= 60
                                            ? 'text-amber-700'
                                            : 'text-rose-700'
                                        }`}
                                      >
                                        {row.score} 分
                                      </span>
                                      <span
                                        className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${
                                          row.status === 'match'
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                            : row.status === 'partial'
                                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                                            : row.status === 'missing'
                                            ? 'bg-gray-100 text-gray-600 border-gray-200'
                                            : 'bg-rose-50 text-rose-700 border-rose-200'
                                        }`}
                                      >
                                        {row.statusText}
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* 上：期望标准输出 */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-700">
                              期望标准输出 (Expected Ground Truth)
                            </span>
                          </div>
                          <pre className="p-3 bg-white border border-gray-200 rounded-lg font-mono text-xs text-gray-800 whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {formatJsonStr(detailItem.expected_output) || <span className="text-gray-400 italic">无期望标准</span>}
                          </pre>
                        </div>

                        {/* 下：Agent 实际输出 */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-700">
                              Agent 实际输出 (Actual Output)
                            </span>
                          </div>
                          <pre
                            className={`p-3 rounded-lg border font-mono text-xs whitespace-pre-wrap max-h-56 overflow-y-auto ${
                              detailItem.status === 'ERROR'
                                ? 'bg-rose-50/60 border-rose-200 text-rose-800'
                                : 'bg-white border-gray-200 text-gray-900'
                            }`}
                          >
                            {detailItem.status === 'ERROR'
                              ? detailItem.error_message
                              : formatJsonStr(detailItem.actual_output) || <span className="text-gray-400 italic">无实际输出</span>}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 3. 评测模块细分明细 */}
              {(() => {
                let details: EvaluatorDetail[] = [];
                try {
                  details = JSON.parse(detailItem.machine_details_json);
                } catch {}
                if (details.length === 0) return null;

                return (
                  <div>
                    <span className="text-xs font-semibold text-gray-700 block mb-2">
                      评测模块打分明细 (综合得分: {detailItem.machine_score} 分)
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {details.map((d, i) => (
                        <div
                          key={i}
                          className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs flex items-start justify-between gap-2"
                        >
                          <div>
                            <div className="font-semibold text-gray-800 flex items-center gap-1.5">
                              {d.evaluator_name}
                              <span className="font-normal text-gray-400 text-[11px]">
                                ({d.type}, 权重 {d.weight})
                              </span>
                            </div>
                            <div className="text-gray-600 mt-1 text-[11px] leading-relaxed">{d.reason}</div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="font-semibold text-gray-900 block text-xs">{d.score} 分</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${
                                d.passed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                              }`}
                            >
                              {d.passed ? '通过' : '未通过'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* 4. 人工复核备注 */}
              {detailItem.human_comment && (
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-800">
                  <div className="font-semibold mb-0.5 flex items-center gap-1.5 text-gray-900">
                    <UserCheck className="w-3.5 h-3.5 text-gray-600" />
                    人工复核备注 ({detailItem.reviewer_name}，评分: {detailItem.human_score}分，
                    {detailItem.human_passed ? '通过' : '未通过'}):
                  </div>
                  <div className="text-gray-600 mt-1">{detailItem.human_comment}</div>
                </div>
              )}

              {/* 5. 执行日志 */}
              {detailItem.execution_log && (
                <div>
                  <button
                    onClick={() => setExpandedLogId(expandedLogId === detailItem.id ? null : detailItem.id)}
                    className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 font-mono font-semibold"
                  >
                    {expandedLogId === detailItem.id ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                    Goja 场景脚本执行日志 (Execution Log)
                  </button>
                  {expandedLogId === detailItem.id && (
                    <pre className="mt-2 p-3 bg-slate-900 text-slate-200 rounded-lg text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {detailItem.execution_log}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* 弹窗底部操作栏 */}
            <div className="px-6 py-3.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-xs text-gray-600">
                  <Cpu className="w-3.5 h-3.5 text-blue-600" />
                  <span>机器评分:</span>
                  <b className="text-gray-900">{detailItem.machine_score} 分</b>
                  <span className={detailItem.machine_passed ? 'text-emerald-600 font-bold' : 'text-red-500 font-bold'}>
                    ({detailItem.machine_passed ? '通过' : '未通过'})
                  </span>
                </div>
                {detailItem.reviewed_at && (
                  <div className="flex items-center gap-1 text-xs text-gray-700 border-l border-gray-200 pl-3">
                    <UserCheck className="w-3.5 h-3.5 text-gray-500" />
                    <span>人工复核:</span>
                    <b className="text-gray-900">{detailItem.human_score} 分</b>
                    <span className={detailItem.human_passed ? 'text-emerald-700 font-medium' : 'text-rose-600 font-medium'}>
                      ({detailItem.human_passed ? '通过' : '未通过'})
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleReevaluateItem(detailItem)}
                  disabled={reevaluatingItemId === detailItem.id}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                  title="从用例集同步最新期望并重新评测该用例"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${reevaluatingItemId === detailItem.id ? 'animate-spin' : ''}`} />
                  {reevaluatingItemId === detailItem.id ? '正在重新评测...' : '更新用例重新评测'}
                </button>
                <button
                  type="button"
                  onClick={() => openReviewModal(detailItem)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg shadow-sm transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" /> {detailItem.reviewed_at ? '重新复核' : '人工复核'}
                </button>
                <button
                  type="button"
                  onClick={() => setDetailItem(null)}
                  className="px-3.5 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 人工复核编辑抽屉/弹窗 */}
      {reviewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-gray-600" /> 人工复核: 用例 #{reviewItem.test_case_id}
              </h3>
              <button onClick={() => setReviewItem(null)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">
                ×
              </button>
            </div>

            <form onSubmit={handleSaveReview} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">人工评分 (0-100) *</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    required
                    value={reviewScore}
                    onChange={(e) => setReviewScore(Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg text-sm font-bold text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">是否通过判定 *</label>
                  <select
                    value={reviewPassed ? 'true' : 'false'}
                    onChange={(e) => setReviewPassed(e.target.value === 'true')}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                  >
                    <option value="true">判定通过 (Passed)</option>
                    <option value="false">判定未通过 (Failed)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">质检人姓名/工号</label>
                <input
                  type="text"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">复核理由与反馈批注</label>
                <textarea
                  rows={4}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="记录人工判定依据，如: 回答虽未精确命中关键字，但语义完全一致，予以通过"
                  className="w-full p-2.5 border rounded-lg text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setReviewItem(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={savingReview}
                  className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 font-medium disabled:opacity-50"
                >
                  {savingReview ? '正在保存...' : '提交人工复核'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
