import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Dataset, TestCase, DatasetColumn, CaseLatestRun } from '../types';
import { TagBadges } from '../components/TagBadges';
import { ScenarioTagEditor } from '../components/ScenarioTagEditor';
import { parseTags } from '../utils/tags';
import {
  Plus,
  Trash2,
  Edit3,
  Database,
  RefreshCw,
  Upload,
  Download,
  SlidersHorizontal,
  Table as TableIcon,
  Check,
  X,
  FileSpreadsheet,
  Copy,
  FileCode,
  ArrowDownLeft,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

export const DatasetsPage: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [casesLoading, setCasesLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 用例集新建/编辑弹窗
  const [dsModalOpen, setDsModalOpen] = useState(false);
  const [editingDs, setEditingDs] = useState<Dataset | null>(null);
  const [dsName, setDsName] = useState('');
  const [dsDesc, setDsDesc] = useState('');
  const [dsScenarioTags, setDsScenarioTags] = useState<string[]>(['*']);
  const [availableScenarioTags, setAvailableScenarioTags] = useState<string[]>([]);

  // 动态列配置弹窗
  const [colModalOpen, setColModalOpen] = useState(false);
  const [editingCols, setEditingCols] = useState<DatasetColumn[]>([]);
  const [newColKey, setNewColKey] = useState('');
  const [newColLabel, setNewColLabel] = useState('');
  const [newColType, setNewColType] = useState<'input' | 'expected' | 'metadata'>('input');
  const [copiedCols, setCopiedCols] = useState(false);
  const [showColJsonImport, setShowColJsonImport] = useState(false);
  const [colJsonText, setColJsonText] = useState('');
  const [colJsonError, setColJsonError] = useState('');
  const [colErrorMsg, setColErrorMsg] = useState('');
  const [colSaving, setColSaving] = useState(false);

  // 用例行添加/编辑弹窗
  const [caseModalOpen, setCaseModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<TestCase | null>(null);
  const [caseFormRow, setCaseFormRow] = useState<Record<string, string>>({});
  const [latestRun, setLatestRun] = useState<CaseLatestRun | null>(null);
  const [latestRunLoading, setLatestRunLoading] = useState(false);
  const [highlightedColKeys, setHighlightedColKeys] = useState<string[]>([]);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [copiedActual, setCopiedActual] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 批量导入弹窗
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchJsonText, setBatchJsonText] = useState('');
  const [batchError, setBatchError] = useState('');

  // 解析当前选中数据集的列配置
  const getColumns = (ds: Dataset | null): DatasetColumn[] => {
    if (!ds) return [];
    try {
      if (ds.columns_json && ds.columns_json.trim() !== '') {
        const parsed = JSON.parse(ds.columns_json);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [
      { key: 'prompt', label: '输入提示词', type: 'input' },
      { key: 'expected', label: '期望输出', type: 'expected' },
      { key: 'category', label: '意图分类', type: 'metadata' },
    ];
  };

  const currentColumns = getColumns(selectedDataset);

  interface GroupedColumns {
    inputs: DatasetColumn[];
    expecteds: DatasetColumn[];
    metadatas: DatasetColumn[];
    orderedCols: DatasetColumn[];
  }

  // 按类型保序分组工具：各组内部严格遵循用户输入顺序
  const getGroupedColumns = (cols: DatasetColumn[]): GroupedColumns => {
    const inputs: DatasetColumn[] = [];
    const expecteds: DatasetColumn[] = [];
    const metadatas: DatasetColumn[] = [];

    cols.forEach((col) => {
      if (col.type === 'expected' || col.key === 'expected' || col.key === 'expected_output') {
        expecteds.push(col);
      } else if (col.type === 'metadata') {
        metadatas.push(col);
      } else {
        inputs.push(col);
      }
    });

    return {
      inputs,
      expecteds,
      metadatas,
      orderedCols: [...inputs, ...expecteds, ...metadatas],
    };
  };

  const groupedColumns = getGroupedColumns(currentColumns);

  const loadDatasets = async () => {
    setLoading(true);
    try {
      const [data, scenariosData] = await Promise.all([
        apiClient.getDatasets(),
        apiClient.getScenarios().catch(() => []),
      ]);
      setDatasets(data);
      const tagsSet = new Set<string>();
      scenariosData.forEach(sc => {
        parseTags(sc.tags_json).forEach(t => {
          if (t !== '*' && t.toLowerCase() !== 'global') tagsSet.add(t);
        });
      });
      setAvailableScenarioTags(Array.from(tagsSet));
      if (data.length > 0 && !selectedDataset) {
        selectDs(data[0]);
      } else if (selectedDataset) {
        const found = data.find((d) => d.id === selectedDataset.id);
        if (found) setSelectedDataset(found);
      }
    } catch (e: any) {
      alert('加载用例集失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const selectDs = async (ds: Dataset) => {
    setSelectedDataset(ds);
    setCasesLoading(true);
    try {
      const caseList = await apiClient.getCases(ds.id);
      setCases(caseList);
    } catch (e: any) {
      alert('加载用例失败: ' + e.message);
    } finally {
      setCasesLoading(false);
    }
  };

  useEffect(() => {
    loadDatasets();
  }, []);

  // 保存用例集
  const handleSaveDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingDs) {
        await apiClient.updateDataset(editingDs.id, {
          name: dsName,
          description: dsDesc,
          scenario_tags_json: JSON.stringify(dsScenarioTags),
        });
      } else {
        const defaultCols: DatasetColumn[] = [
          { key: 'prompt', label: '输入提示词', type: 'input' },
          { key: 'expected', label: '期望输出', type: 'expected' },
          { key: 'category', label: '意图分类', type: 'metadata' },
        ];
        const created = await apiClient.createDataset({
          name: dsName,
          description: dsDesc,
          columns_json: JSON.stringify(defaultCols),
          scenario_tags_json: JSON.stringify(dsScenarioTags),
        });
        setSelectedDataset(created);
      }
      setDsModalOpen(false);
      loadDatasets();
    } catch (e: any) {
      alert('保存失败: ' + e.message);
    }
  };

  const handleDeleteDataset = async (id: number) => {
    if (!confirm('确定要删除该用例集及其所有用例吗？')) return;
    try {
      await apiClient.deleteDataset(id);
      if (selectedDataset?.id === id) {
        setSelectedDataset(null);
        setCases([]);
      }
      loadDatasets();
    } catch (e: any) {
      alert('删除失败: ' + e.message);
    }
  };

  // 导出全部用例为 JSON 文件
  const handleExportCases = async () => {
    if (!selectedDataset) return;
    try {
      setExporting(true);
      const data = await apiClient.exportCases(selectedDataset.id);
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = selectedDataset.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
      link.href = url;
      link.setAttribute('download', `dataset_${selectedDataset.id}_${safeName}_cases.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('导出用例失败: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  // 根据标签生成合法字段 Key
  const generateColKey = (label: string): string => {
    const ascii = label.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (ascii) return ascii;
    return `col_${Date.now().toString().slice(-4)}`;
  };

  // 列配置逻辑
  const openColConfigModal = () => {
    if (!selectedDataset) return;
    setEditingCols([...currentColumns]);
    setNewColKey('');
    setNewColLabel('');
    setNewColType('input');
    setCopiedCols(false);
    setShowColJsonImport(false);
    setColJsonText('');
    setColJsonError('');
    setColErrorMsg('');
    setColModalOpen(true);
  };

  // 复制当前列配置为 JSON
  const handleCopyColsJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(editingCols, null, 2));
      setCopiedCols(true);
      setTimeout(() => setCopiedCols(false), 2000);
    } catch {
      alert('复制到剪贴板失败，可手动打开 JSON 导入框全选复制');
    }
  };

  // 从 JSON 导入列配置
  const handleImportColsJson = () => {
    setColJsonError('');
    try {
      const parsed = JSON.parse(colJsonText);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setColJsonError('JSON 必须为非空的列配置对象数组');
        return;
      }
      const validated: DatasetColumn[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (!item || typeof item !== 'object') {
          setColJsonError(`第 ${i + 1} 项不是有效对象`);
          return;
        }
        if (!item.key || typeof item.key !== 'string' || !item.key.trim()) {
          setColJsonError(`第 ${i + 1} 项缺少或含有非法的 key 字段`);
          return;
        }
        const key = item.key.trim();
        const label = item.label && typeof item.label === 'string' ? item.label.trim() : key;
        let type: 'input' | 'expected' | 'metadata' = 'input';
        if (item.type === 'expected' || item.type === 'metadata' || item.type === 'input') {
          type = item.type;
        }
        if (validated.some((c) => c.key === key)) {
          setColJsonError(`存在重复的 key: "${key}"`);
          return;
        }
        validated.push({ key, label, type });
      }
      setEditingCols(validated);
      setShowColJsonImport(false);
      setColJsonText('');
      setColErrorMsg('');
    } catch (e: any) {
      setColJsonError('JSON 格式错误: ' + e.message);
    }
  };

  const handleAddColumn = (): boolean => {
    setColErrorMsg('');
    const cleanLabel = newColLabel.trim();
    let cleanKey = newColKey.trim();

    if (!cleanLabel && !cleanKey) {
      setColErrorMsg('请填写列标签或字段 Key！');
      return false;
    }

    if (!cleanKey) {
      cleanKey = generateColKey(cleanLabel);
    }
    const finalLabel = cleanLabel || cleanKey;

    if (editingCols.some((c) => c.key === cleanKey)) {
      setColErrorMsg(`已存在相同 Key 的列: "${cleanKey}"，请修改 Key 名称`);
      return false;
    }

    setEditingCols([...editingCols, { key: cleanKey, label: finalLabel, type: newColType }]);
    setNewColKey('');
    setNewColLabel('');
    setNewColType('input');
    setColErrorMsg('');
    return true;
  };

  const handleRemoveColumn = (key: string) => {
    if (editingCols.length <= 1) {
      setColErrorMsg('至少需要保留一列表头！');
      return;
    }
    setEditingCols(editingCols.filter((c) => c.key !== key));
    setColErrorMsg('');
  };

  const handleMoveColumn = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= editingCols.length) return;
    const newCols = [...editingCols];
    const [moved] = newCols.splice(index, 1);
    newCols.splice(targetIndex, 0, moved);
    setEditingCols(newCols);
    setColErrorMsg('');
  };

  const handleSaveColumns = async () => {
    if (!selectedDataset) return;
    setColSaving(true);
    setColErrorMsg('');

    try {
      let finalCols = [...editingCols];

      // 防呆：如果用户在下方输入框中填写了新列但忘记点击“+ 添加列”，自动帮用户添加！
      const pendingLabel = newColLabel.trim();
      let pendingKey = newColKey.trim();
      if (pendingLabel || pendingKey) {
        if (!pendingKey) {
          pendingKey = generateColKey(pendingLabel);
        }
        const effectiveLabel = pendingLabel || pendingKey;
        if (finalCols.some((c) => c.key === pendingKey)) {
          setColErrorMsg(`输入框中的列 Key "${pendingKey}" 与已有列表头重复，请检查`);
          setColSaving(false);
          return;
        }
        finalCols.push({ key: pendingKey, label: effectiveLabel, type: newColType });
      }

      if (finalCols.length === 0) {
        setColErrorMsg('表头至少需要保留一列！');
        setColSaving(false);
        return;
      }

      const jsonStr = JSON.stringify(finalCols);
      const updatedDs = await apiClient.updateDataset(selectedDataset.id, {
        name: selectedDataset.name,
        description: selectedDataset.description || '',
        columns_json: jsonStr,
      });

      const updated = { ...selectedDataset, ...updatedDs, columns_json: jsonStr };
      setSelectedDataset(updated);
      setDatasets((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setEditingCols(finalCols);
      setNewColKey('');
      setNewColLabel('');
      setColModalOpen(false);

      loadDatasets();
    } catch (err: any) {
      setColErrorMsg('保存列配置失败: ' + err.message);
    } finally {
      setColSaving(false);
    }
  };

  // 解析单条用例单元格内容
  const getCellValue = (tc: TestCase, col: DatasetColumn): string => {
    // 1. 如果该列是期望输出类型或 key 为 expected 相关
    if (col.type === 'expected' || col.key === 'expected' || col.key === 'expected_output') {
      if (tc.expected_output) {
        // 先尝试解析为 JSON 对象（支持多期望列字段）
        try {
          const expObj = JSON.parse(tc.expected_output);
          if (expObj && typeof expObj === 'object') {
            if (expObj[col.key] !== undefined) {
              const val = expObj[col.key];
              return typeof val === 'object' ? JSON.stringify(val) : String(val);
            }
          }
        } catch {}

        // 如果不是有效 JSON 或该 key 未在对象中命中：
        // 只有当数据集仅包含 1 个期望列，或列 key 明确为 expected/expected_output 时，才回退返回整体字符串
        const expectedCols = currentColumns.filter((c) => c.type === 'expected');
        if (expectedCols.length <= 1 || col.key === 'expected' || col.key === 'expected_output') {
          return tc.expected_output;
        }
      }
    }

    // 2. 优先从 input_data JSON 中匹配 key
    try {
      const inputObj = JSON.parse(tc.input_data);
      if (inputObj && typeof inputObj === 'object' && inputObj[col.key] !== undefined) {
        const val = inputObj[col.key];
        return typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
    } catch {
      if (col.key === 'prompt' || col.key === 'input' || col.key === 'query') {
        return tc.input_data;
      }
    }

    // 3. 从 metadata_json 中匹配
    try {
      const metaObj = JSON.parse(tc.metadata_json);
      if (metaObj && typeof metaObj === 'object' && metaObj[col.key] !== undefined) {
        const val = metaObj[col.key];
        return typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
    } catch {}

    if (col.key === 'prompt' || col.key === 'input') {
      return tc.input_data;
    }
    return '';
  };

  const formatJsonStr = (raw: string): string => {
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  };

  // 从真实输出中提取 JSON 对象（兼容 Markdown ```json 代码块）
  const extractJsonObject = (raw: string | undefined): Record<string, any> | null => {
    if (!raw || !raw.trim()) return null;
    const trimmed = raw.trim();
    let parsed: any = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        try {
          parsed = JSON.parse(match[1].trim());
        } catch {}
      }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  };

  // 根据期望列 key 从真实输出中匹配值
  // 规则：从输出 json 中匹配 key 值，如果输出不是 json 或没有该字段展示为空
  const getMatchedActualValue = (
    colKey: string,
    raw: string | undefined
  ): { hasMatch: boolean; valueStr: string } => {
    const jsonObj = extractJsonObject(raw);
    if (!jsonObj) {
      return { hasMatch: false, valueStr: '' };
    }

    // 1. 精确匹配 key
    if (colKey in jsonObj) {
      const val = jsonObj[colKey];
      const str =
        typeof val === 'object' && val !== null
          ? JSON.stringify(val, null, 2)
          : String(val ?? '');
      return { hasMatch: true, valueStr: str };
    }

    // 2. 忽略大小写匹配 key
    const lowerKey = colKey.toLowerCase();
    const matchedKey = Object.keys(jsonObj).find(
      (k) => k.toLowerCase() === lowerKey
    );
    if (matchedKey !== undefined) {
      const val = jsonObj[matchedKey];
      const str =
        typeof val === 'object' && val !== null
          ? JSON.stringify(val, null, 2)
          : String(val ?? '');
      return { hasMatch: true, valueStr: str };
    }

    return { hasMatch: false, valueStr: '' };
  };

  const triggerColHighlight = (keys: string[]) => {
    setHighlightedColKeys(keys);
    setTimeout(() => {
      setHighlightedColKeys([]);
    }, 1600);
  };

  // 单字段采纳填入
  const handleAdoptSingleField = (colKey: string, valueStr: string) => {
    setCaseFormRow((prev) => ({ ...prev, [colKey]: valueStr }));
    triggerColHighlight([colKey]);
  };

  // 批量采纳所有成功匹配到的期望字段
  const handleAdoptAllMatchedFields = () => {
    if (!latestRun?.actual_output) return;
    const updated = { ...caseFormRow };
    const matchedKeys: string[] = [];

    currentColumns.forEach((col) => {
      const isExpected =
        col.type === 'expected' ||
        col.key === 'expected' ||
        col.key === 'expected_output';
      if (isExpected) {
        const { hasMatch, valueStr } = getMatchedActualValue(col.key, latestRun.actual_output);
        if (hasMatch) {
          updated[col.key] = valueStr;
          matchedKeys.push(col.key);
        }
      }
    });

    if (matchedKeys.length === 0) {
      alert('输出 JSON 中未找到与当前期望列匹配的 key');
      return;
    }

    setCaseFormRow(updated);
    triggerColHighlight(matchedKeys);
  };

  // 统计当前有多少个期望字段成功匹配到了真实输出
  const getMatchedExpectedCount = (): number => {
    if (!latestRun?.actual_output) return 0;
    let count = 0;
    currentColumns.forEach((col) => {
      const isExpected =
        col.type === 'expected' ||
        col.key === 'expected' ||
        col.key === 'expected_output';
      if (isExpected) {
        const { hasMatch } = getMatchedActualValue(col.key, latestRun.actual_output);
        if (hasMatch) count++;
      }
    });
    return count;
  };

  // 打开添加/编辑用例弹窗
  const openCaseModal = async (tc: TestCase | null) => {
    setEditingCase(tc);
    const rowData: Record<string, string> = {};
    currentColumns.forEach((col) => {
      rowData[col.key] = tc ? getCellValue(tc, col) : '';
    });
    setCaseFormRow(rowData);
    setLatestRun(null);
    setHighlightedColKeys([]);
    setShowRawOutput(false);
    setCopiedActual(false);
    setCopiedKey(null);
    setCaseModalOpen(true);

    if (tc) {
      setLatestRunLoading(true);
      try {
        const runRes = await apiClient.getCaseLatestRun(tc.id);
        setLatestRun(runRes);
      } catch (err) {
        console.error('获取用例最新执行记录失败', err);
      } finally {
        setLatestRunLoading(false);
      }
    }
  };

  // 保存用例行
  const handleSaveCaseRow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDataset) return;

    // 组装 input_data, expected_output, metadata_json
    const inputObj: Record<string, any> = {};
    const expectedObj: Record<string, any> = {};
    const metaObj: Record<string, any> = {};

    currentColumns.forEach((col) => {
      const val = caseFormRow[col.key] || '';
      if (col.type === 'expected' || col.key === 'expected' || col.key === 'expected_output') {
        expectedObj[col.key] = val;
      } else if (col.type === 'metadata') {
        metaObj[col.key] = val;
      } else {
        inputObj[col.key] = val;
      }
    });

    // 如果只有一个 input 列且是 prompt，保持简洁
    const inputKeys = Object.keys(inputObj);
    let finalInputData = '';
    if (inputKeys.length === 1 && inputKeys[0] === 'prompt') {
      finalInputData = JSON.stringify({ prompt: inputObj.prompt });
    } else {
      finalInputData = JSON.stringify(inputObj);
    }

    // 处理 expected_output：如果只有一个期望列且 key 为 expected 或 expected_output，直接存纯文本保持兼容；否则存为 JSON
    const expectedKeys = Object.keys(expectedObj);
    let finalExpectedOutput = '';
    if (expectedKeys.length === 1 && (expectedKeys[0] === 'expected' || expectedKeys[0] === 'expected_output')) {
      finalExpectedOutput = expectedObj[expectedKeys[0]];
    } else if (expectedKeys.length > 0) {
      finalExpectedOutput = JSON.stringify(expectedObj);
    }

    const payload = {
      input_data: finalInputData,
      expected_output: finalExpectedOutput,
      metadata_json: JSON.stringify(metaObj),
    };

    try {
      if (editingCase) {
        await apiClient.updateCase(editingCase.id, payload);
      } else {
        await apiClient.createCase(selectedDataset.id, payload);
      }
      setCaseModalOpen(false);
      selectDs(selectedDataset);
      loadDatasets();
    } catch (e: any) {
      alert('保存用例失败: ' + e.message);
    }
  };

  const handleDeleteCase = async (caseId: number) => {
    if (!confirm('确定删除该行用例吗？')) return;
    try {
      await apiClient.deleteCase(caseId);
      if (selectedDataset) selectDs(selectedDataset);
      loadDatasets();
    } catch (e: any) {
      alert('删除失败: ' + e.message);
    }
  };

  // 批量导入
  const handleBatchImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDataset) return;
    setBatchError('');
    try {
      const parsed = JSON.parse(batchJsonText);
      if (!Array.isArray(parsed)) {
        setBatchError('导入内容必须是 JSON 数组结构');
        return;
      }

      // 规范化字段格式
      const formattedCases = parsed.map((row: any) => {
        let expectedOutput = '';
        let inputData = '';
        let metadata: Record<string, any> = {};

        // 1. 处理 input_data
        if (row.input_data !== undefined) {
          inputData = typeof row.input_data === 'string' ? row.input_data : JSON.stringify(row.input_data);
        } else {
          // 根据配置的列提取
          const rowInput: Record<string, any> = {};
          currentColumns.forEach((c) => {
            if (c.type === 'input') {
              if (row[c.key] !== undefined) rowInput[c.key] = row[c.key];
            }
          });
          inputData = JSON.stringify(rowInput);
        }

        // 2. 处理 metadata
        if (row.metadata !== undefined || row.metadata_json !== undefined) {
          const rawMeta = row.metadata !== undefined ? row.metadata : row.metadata_json;
          metadata = typeof rawMeta === 'string' ? JSON.parse(rawMeta || '{}') : (rawMeta || {});
        } else {
          currentColumns.forEach((c) => {
            if (c.type === 'metadata') {
              if (row[c.key] !== undefined) metadata[c.key] = row[c.key];
            }
          });
        }

        // 3. 处理 expected_output
        if (row.expected_output !== undefined && typeof row.expected_output === 'string') {
          expectedOutput = row.expected_output;
        } else {
          const rowExpected: Record<string, any> = {};
          currentColumns.forEach((c) => {
            if (c.type === 'expected') {
              if (row[c.key] !== undefined) rowExpected[c.key] = row[c.key];
            }
          });

          // 如果用户导入的数据中直接带有 expected / expected_output 字段
          if (row.expected !== undefined && rowExpected.expected === undefined) {
            rowExpected.expected = row.expected;
          }
          if (row.expected_output !== undefined && rowExpected.expected_output === undefined) {
            rowExpected.expected_output = row.expected_output;
          }

          const expKeys = Object.keys(rowExpected);
          if (expKeys.length === 1 && (expKeys[0] === 'expected' || expKeys[0] === 'expected_output')) {
            expectedOutput = typeof rowExpected[expKeys[0]] === 'object'
              ? JSON.stringify(rowExpected[expKeys[0]])
              : String(rowExpected[expKeys[0]]);
          } else if (expKeys.length > 0) {
            expectedOutput = JSON.stringify(rowExpected);
          } else if (row.expected !== undefined) {
            expectedOutput = typeof row.expected === 'object' ? JSON.stringify(row.expected) : String(row.expected);
          }
        }

        return {
          input_data: inputData,
          expected_output: expectedOutput,
          metadata: metadata,
        };
      });

      await apiClient.batchImportCases(selectedDataset.id, formattedCases);
      setBatchModalOpen(false);
      selectDs(selectedDataset);
      loadDatasets();
    } catch (err: any) {
      setBatchError('导入失败: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* 顶部标题与用例集切换栏 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">评测用例集 (Datasets)</h2>
          <p className="text-sm text-gray-500 mt-1">
            支持动态配置自定义列，以表格列表形式高效组织和管理评测样本行
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* 用例集选择下拉 */}
          <select
            value={selectedDataset?.id || ''}
            onChange={(e) => {
              const ds = datasets.find((d) => d.id === Number(e.target.value));
              if (ds) selectDs(ds);
            }}
            className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg shadow-sm font-medium text-gray-800"
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.case_count} 条用例)
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              setEditingDs(null);
              setDsName('');
              setDsDesc('');
              setDsScenarioTags(['*']);
              setDsModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 shadow-sm font-medium"
          >
            <Plus className="w-4 h-4 text-blue-600" /> 新建集
          </button>

          {selectedDataset && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setEditingDs(selectedDataset);
                  setDsName(selectedDataset.name);
                  setDsDesc(selectedDataset.description || '');
                  setDsScenarioTags(parseTags(selectedDataset.scenario_tags_json));
                  setDsModalOpen(true);
                }}
                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-white border border-gray-200 rounded-lg shadow-sm"
                title="编辑当前用例集属性"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleDeleteDataset(selectedDataset.id)}
                className="p-2 text-gray-500 hover:text-red-600 hover:bg-white border border-gray-200 rounded-lg shadow-sm"
                title="删除当前用例集及其所有用例"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedDataset ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
          {/* 工具栏: 描述 + 操作按钮 */}
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 text-base">{selectedDataset.name}</span>
                <TagBadges tags={selectedDataset.scenario_tags_json} />
                <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 font-semibold rounded-md">
                  {cases.length} 行用例
                </span>
                <span className="text-xs text-gray-400">ID: #{selectedDataset.id}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{selectedDataset.description || '暂无描述'}</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap flex-shrink-0">
              <button
                onClick={openColConfigModal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm whitespace-nowrap flex-shrink-0"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" /> 配置列 ({currentColumns.length})
              </button>

              <button
                onClick={() => {
                  const sampleObj: any = {};
                  currentColumns.forEach((c) => {
                    sampleObj[c.key] = c.type === 'expected' ? '期望的参考答案' : '示例内容';
                  });
                  setBatchJsonText(JSON.stringify([sampleObj], null, 2));
                  setBatchError('');
                  setBatchModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm whitespace-nowrap flex-shrink-0"
              >
                <Upload className="w-3.5 h-3.5" /> 批量导入
              </button>

              <button
                onClick={handleExportCases}
                disabled={exporting || cases.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm disabled:opacity-50 transition-colors whitespace-nowrap flex-shrink-0"
                title={cases.length === 0 ? '暂无用例可导出' : '导出全部用例为 JSON 文件'}
              >
                <Download className={`w-3.5 h-3.5 text-emerald-600 ${exporting ? 'animate-bounce' : ''}`} /> 导出用例
              </button>

              <button
                onClick={() => openCaseModal(null)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm whitespace-nowrap flex-shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> 添加行 (用例)
              </button>
            </div>
          </div>

          {/* 表格主体: 每行一个用例 */}
          <div className="overflow-x-auto">
            {casesLoading ? (
              <div className="text-center py-20 text-gray-400">正在读取用例列表...</div>
            ) : cases.length === 0 ? (
              <div className="text-center py-24 text-gray-400">
                <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                当前用例集暂无数据行，请点击右上角「添加行」或「批量导入」
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  {/* 第一级大表头：三大类型保序聚合 */}
                  <tr className="border-b border-gray-200 text-[11px] font-bold select-none">
                    <th rowSpan={2} className="py-2 px-3 w-12 text-center bg-gray-100/80 text-gray-500 border-r border-gray-200">
                      #
                    </th>
                    {groupedColumns.inputs.length > 0 && (
                      <th
                        colSpan={groupedColumns.inputs.length}
                        className="py-1.5 px-3 text-center bg-blue-50/70 text-blue-800 border-r border-gray-200 font-bold"
                      >
                        被测输入 ({groupedColumns.inputs.length})
                      </th>
                    )}
                    {groupedColumns.expecteds.length > 0 && (
                      <th
                        colSpan={groupedColumns.expecteds.length}
                        className="py-1.5 px-3 text-center bg-emerald-50/70 text-emerald-800 border-r border-gray-200 font-bold"
                      >
                        期望输出 ({groupedColumns.expecteds.length})
                      </th>
                    )}
                    {groupedColumns.metadatas.length > 0 && (
                      <th
                        colSpan={groupedColumns.metadatas.length}
                        className="py-1.5 px-3 text-center bg-purple-50/70 text-purple-800 border-r border-gray-200 font-bold"
                      >
                        扩展元数据 ({groupedColumns.metadatas.length})
                      </th>
                    )}
                    <th rowSpan={2} className="py-2 px-3 w-20 text-right bg-gray-100/80 text-gray-500">
                      操作
                    </th>
                  </tr>

                  {/* 第二级子表头：具体列定义（按输入顺序排布） */}
                  <tr className="bg-gray-50/90 border-b border-gray-200 text-gray-600 font-semibold tracking-wider">
                    {groupedColumns.orderedCols.map((col, cIdx) => {
                      const isLastInGroup =
                        col === groupedColumns.inputs[groupedColumns.inputs.length - 1] ||
                        col === groupedColumns.expecteds[groupedColumns.expecteds.length - 1] ||
                        col === groupedColumns.metadatas[groupedColumns.metadatas.length - 1];

                      return (
                        <th
                          key={col.key}
                          className={`py-2 px-3 min-w-[140px] ${
                            isLastInGroup && cIdx < groupedColumns.orderedCols.length - 1
                              ? 'border-r border-gray-200'
                              : ''
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-800 font-medium">{col.label}</span>
                            <span className="font-mono text-[10px] text-gray-400 font-normal">({col.key})</span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-normal text-gray-800">
                  {cases.map((tc, idx) => (
                    <tr key={tc.id} className="hover:bg-blue-50/40 transition-colors group">
                      <td className="py-3 px-3 text-center font-mono text-gray-400 select-none border-r border-gray-100">
                        {idx + 1}
                      </td>
                      {groupedColumns.orderedCols.map((col, cIdx) => {
                        const cellVal = getCellValue(tc, col);
                        const isLastInGroup =
                          col === groupedColumns.inputs[groupedColumns.inputs.length - 1] ||
                          col === groupedColumns.expecteds[groupedColumns.expecteds.length - 1] ||
                          col === groupedColumns.metadatas[groupedColumns.metadatas.length - 1];

                        return (
                          <td
                            key={col.key}
                            className={`py-3 px-3 max-w-xs truncate ${
                              isLastInGroup && cIdx < groupedColumns.orderedCols.length - 1
                                ? 'border-r border-gray-100'
                                : ''
                            }`}
                            title={cellVal}
                          >
                            {cellVal ? (
                              <span className={col.type === 'expected' ? 'font-medium text-emerald-900' : ''}>
                                {cellVal}
                              </span>
                            ) : (
                              <span className="text-gray-300 italic">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100">
                          <button
                            onClick={() => openCaseModal(tc)}
                            className="p-1 text-gray-400 hover:text-blue-600 rounded"
                            title="编辑此行"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteCase(tc.id)}
                            className="p-1 text-gray-400 hover:text-red-600 rounded"
                            title="删除此行"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-20 bg-white border border-gray-200 rounded-xl text-gray-400">
          请选择或创建一个用例集
        </div>
      )}

      {/* 动态配置列弹窗 */}
      {colModalOpen && selectedDataset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b gap-3 flex-nowrap">
              <div className="flex items-center gap-2 min-w-0">
                <SlidersHorizontal className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                <h3
                  className="text-base sm:text-lg font-bold text-gray-900 truncate whitespace-nowrap"
                  title={`配置用例列表头字段 (${selectedDataset.name})`}
                >
                  配置表头列 <span className="text-xs sm:text-sm text-gray-500 font-normal">({selectedDataset.name})</span>
                </h3>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                <button
                  type="button"
                  onClick={handleCopyColsJson}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors whitespace-nowrap flex-shrink-0"
                  title="复制当前列配置为 JSON 数组"
                >
                  {copiedCols ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-gray-500" />}
                  <span>{copiedCols ? '已复制 JSON' : '复制配置 JSON'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextState = !showColJsonImport;
                    setShowColJsonImport(nextState);
                    if (nextState) {
                      setColJsonText(JSON.stringify(editingCols, null, 2));
                    }
                    setColJsonError('');
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap flex-shrink-0 ${
                    showColJsonImport ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  title="通过 JSON 格式导入或批量修改列配置"
                >
                  <FileCode className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{showColJsonImport ? '收起 JSON' : '从 JSON 导入'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setColModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl font-bold ml-1 leading-none p-1 flex-shrink-0"
                  title="关闭"
                >
                  ×
                </button>
              </div>
            </div>

            <p className="text-xs text-gray-500">
              设置此用例集的表头列定义。输入列 (Input) 将作为入参传入场景脚本；期望列 (Expected) 用于自动评测与比对。
            </p>

            {/* JSON 导入折叠区 */}
            {showColJsonImport && (
              <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-indigo-950">
                  <span>粘贴或编辑 JSON 列配置数组 (key, label, type):</span>
                  <button
                    type="button"
                    onClick={() => {
                      setColJsonText(
                        JSON.stringify(
                          [
                            { key: 'prompt', label: '输入提示词', type: 'input' },
                            { key: 'expected', label: '期望输出', type: 'expected' },
                            { key: 'category', label: '意图分类', type: 'metadata' }
                          ],
                          null,
                          2
                        )
                      );
                      setColJsonError('');
                    }}
                    className="text-[11px] text-indigo-600 hover:underline"
                  >
                    填入预设模板
                  </button>
                </div>
                {colJsonError && (
                  <div className="p-2 text-xs text-red-600 bg-red-100/70 border border-red-200 rounded">
                    {colJsonError}
                  </div>
                )}
                <textarea
                  rows={6}
                  value={colJsonText}
                  onChange={(e) => setColJsonText(e.target.value)}
                  className="w-full p-2.5 font-mono text-xs border border-indigo-200 rounded bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder={`[\n  { "key": "query", "label": "用户问题", "type": "input" },\n  { "key": "expected", "label": "期望回答", "type": "expected" }\n]`}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowColJsonImport(false)}
                    className="px-3 py-1 text-xs text-gray-600 hover:bg-indigo-100 rounded"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleImportColsJson}
                    className="px-3 py-1 text-xs bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 shadow-sm"
                  >
                    解析并导入列
                  </button>
                </div>
              </div>
            )}

            {/* 现有列列表 */}
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {editingCols.map((col, idx) => (
                <div
                  key={col.key}
                  className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-200 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-gray-400 w-4">#{idx + 1}</span>
                    <span className="font-bold text-gray-800">{col.label}</span>
                    <span className="font-mono text-gray-500 bg-white px-2 py-0.5 rounded border border-gray-200">
                      key: {col.key}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${
                        col.type === 'expected'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : col.type === 'metadata'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}
                    >
                      {col.type === 'expected' ? '期望输出' : col.type === 'metadata' ? '扩展元数据' : '被测输入'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveColumn(idx, 'up')}
                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:hover:text-gray-400 rounded transition-colors"
                      title="上移"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === editingCols.length - 1}
                      onClick={() => handleMoveColumn(idx, 'down')}
                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:hover:text-gray-400 rounded transition-colors"
                      title="下移"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveColumn(col.key)}
                      className="p-1 text-gray-400 hover:text-red-600 rounded ml-1 transition-colors"
                      title="删除列"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {colErrorMsg && (
              <div className="p-2.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                <span>⚠️ {colErrorMsg}</span>
              </div>
            )}

            {/* 新增列操作区 */}
            <div className="pt-3 border-t space-y-2">
              <span className="text-xs font-semibold text-gray-700 block">添加新列 (按回车或点击添加按钮加入):</span>
              <div className="grid grid-cols-12 gap-2">
                <input
                  type="text"
                  placeholder="列标签 (如: 用户角色)"
                  value={newColLabel}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewColLabel(val);
                    if (!newColKey || newColKey.startsWith('col_')) {
                      setNewColKey(generateColKey(val));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddColumn();
                    }
                  }}
                  className="col-span-4 px-2.5 py-1.5 border rounded-lg text-xs"
                />
                <input
                  type="text"
                  placeholder="字段 Key (如: role)"
                  value={newColKey}
                  onChange={(e) => setNewColKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddColumn();
                    }
                  }}
                  className="col-span-3 px-2.5 py-1.5 border rounded-lg text-xs font-mono"
                />
                <select
                  value={newColType}
                  onChange={(e) => setNewColType(e.target.value as any)}
                  className="col-span-3 px-2 py-1.5 border rounded-lg text-xs bg-white"
                >
                  <option value="input">被测输入 (Input)</option>
                  <option value="expected">期望输出 (Expected)</option>
                  <option value="metadata">扩展标签 (Metadata)</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddColumn}
                  className="col-span-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center justify-center gap-1 font-semibold text-xs py-1.5 shadow-sm transition-colors"
                  title="确认添加这一列"
                >
                  <Plus className="w-3.5 h-3.5" /> 添加
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t">
              <span className="text-[11px] text-gray-400">
                提示：编辑或输入完新列后直接点击「保存」会自动合并提交
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setColModalOpen(false)}
                  className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={colSaving}
                  onClick={handleSaveColumns}
                  className="px-4 py-2 text-xs bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {colSaving ? '正在保存...' : '保存列配置'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 用例行新增/编辑弹窗 */}
      {caseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div
            className={`bg-white rounded-xl shadow-xl w-full ${
              editingCase ? 'max-w-4xl' : 'max-w-xl'
            } p-6 space-y-4 max-h-[90vh] flex flex-col transition-all duration-200`}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between pb-3 border-b">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-gray-900">
                  {editingCase ? `编辑用例行 #${editingCase.id}` : '添加单行用例'}
                </h3>
                {selectedDataset && (
                  <span className="text-xs text-gray-400 font-normal">
                    ({selectedDataset.name})
                  </span>
                )}
              </div>
              <button
                onClick={() => setCaseModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
              >
                ×
              </button>
            </div>

            {/* 内容区 */}
            <div className="overflow-y-auto flex-1 p-1 space-y-4">
              {/* 编辑模式下：顶部最近真实运行结果概览条 */}
              {editingCase && (
                <div className="bg-gray-50/90 border border-gray-200 rounded-xl p-3 text-xs space-y-2">
                  {latestRunLoading ? (
                    <div className="flex items-center gap-2 text-gray-500 py-1">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                      <span>正在加载该用例最近一次真实运行结果...</span>
                    </div>
                  ) : !latestRun?.has_run ? (
                    <div className="flex items-center justify-between text-gray-500 py-0.5">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-gray-400" />
                        <span>该用例暂无评测执行历史，右侧参考框展示为空</span>
                      </div>
                      <span className="text-[11px] text-gray-400">发起评测任务后将自动关联展示真实输出</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              latestRun.status === 'COMPLETED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {latestRun.status}
                          </span>
                          <span className="text-gray-500 font-mono text-[11px] flex items-center gap-1">
                            <Clock className="w-3 h-3 text-gray-400" />
                            {latestRun.latency_ms}ms
                          </span>
                          <span className="text-gray-300">|</span>
                          <span className="font-semibold text-gray-800">
                            机器得分: {latestRun.machine_score}分
                          </span>
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.2 rounded ${
                              latestRun.machine_passed
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {latestRun.machine_passed ? '通过' : '未通过'}
                          </span>
                          <span className="text-gray-300">|</span>
                          <span className="text-gray-500 truncate max-w-[200px]" title={latestRun.task_name}>
                            任务: {latestRun.task_name || '未命名任务'}
                          </span>
                          <span className="text-gray-400 font-mono text-[10px]">
                            (Run #{latestRun.run_record_id})
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* 批量采纳所有从输出 JSON 中匹配到的期望字段 */}
                          {getMatchedExpectedCount() > 0 && (
                            <button
                              type="button"
                              onClick={handleAdoptAllMatchedFields}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs flex items-center gap-1 transition-colors"
                              title="将所有从真实输出 JSON 中成功匹配的字段值一键填入左侧期望框"
                            >
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                              <span>采纳所有匹配 ({getMatchedExpectedCount()})</span>
                            </button>
                          )}

                          {/* 展开/收起完整原始输出 */}
                          <button
                            type="button"
                            onClick={() => setShowRawOutput(!showRawOutput)}
                            className="text-[11px] text-gray-600 hover:text-gray-900 border border-gray-200 bg-white px-2 py-1 rounded flex items-center gap-1 hover:bg-gray-50 transition-colors"
                          >
                            <FileCode className="w-3.5 h-3.5 text-gray-500" />
                            <span>{showRawOutput ? '收起完整输出' : '完整输出/评测详情'}</span>
                            {showRawOutput ? (
                              <ChevronDown className="w-3 h-3 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-3 h-3 text-gray-400" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* 展开的完整原始输出与打分明细 */}
                      {showRawOutput && (
                        <div className="pt-2 border-t border-gray-200 space-y-2 mt-1">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-gray-700">
                            <span>完整实际输出 (Raw Output):</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (latestRun.actual_output) {
                                  navigator.clipboard.writeText(latestRun.actual_output);
                                  setCopiedActual(true);
                                  setTimeout(() => setCopiedActual(false), 2000);
                                }
                              }}
                              className="text-blue-600 hover:underline flex items-center gap-1 font-normal text-[10px]"
                            >
                              {copiedActual ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedActual ? '已复制完整输出' : '复制全部文本'}</span>
                            </button>
                          </div>
                          <pre className="p-2.5 bg-white border border-gray-200 rounded-lg text-xs font-mono max-h-48 overflow-y-auto whitespace-pre-wrap text-gray-800 select-text leading-relaxed">
                            {formatJsonStr(latestRun.actual_output || '') || (
                              <span className="text-gray-300 italic">(无实际返回内容)</span>
                            )}
                          </pre>

                          {latestRun.status === 'ERROR' && latestRun.error_message && (
                            <div className="p-2 bg-red-50 text-red-700 text-xs rounded border border-red-200 flex items-start gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0 mt-0.5" />
                              <span className="font-mono text-[11px] break-all">{latestRun.error_message}</span>
                            </div>
                          )}

                          {/* 评测裁判打分明细 */}
                          {latestRun.machine_details_json && (
                            <div className="border border-gray-200 bg-white rounded p-2 text-[11px] space-y-1">
                              <span className="font-semibold text-gray-700 block mb-1">评测裁判明细:</span>
                              {(() => {
                                try {
                                  const details = JSON.parse(latestRun.machine_details_json);
                                  if (Array.isArray(details) && details.length > 0) {
                                    return details.map((d: any, i: number) => (
                                      <div key={i} className="flex flex-col bg-gray-50 p-1.5 rounded">
                                        <div className="flex items-center justify-between font-semibold">
                                          <span>{d.evaluator_name || `裁判 #${i + 1}`}</span>
                                          <span className={d.passed ? 'text-emerald-600' : 'text-amber-600'}>
                                            {d.score}分 ({d.passed ? '通过' : '不通过'})
                                          </span>
                                        </div>
                                        {d.reason && <p className="text-gray-500 text-[10px] mt-0.5">{d.reason}</p>}
                                      </div>
                                    ));
                                  }
                                } catch {}
                                return <p className="text-gray-400 text-[10px]">暂无细项</p>;
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* 主表单区域：三大类型聚合，组内严格遵循用户输入顺序 */}
              <form id="case-form" onSubmit={handleSaveCaseRow} className="space-y-4">
                {/* 1. 被测输入 (Inputs) 聚合区块 */}
                {groupedColumns.inputs.length > 0 && (
                  <div className="space-y-3 bg-blue-50/25 border border-blue-100 rounded-xl p-3.5">
                    <div className="flex items-center justify-between border-b border-blue-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                          被测输入 (Inputs)
                        </span>
                        <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200 font-medium">
                          共 {groupedColumns.inputs.length} 个字段
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400">按定义顺序排布</span>
                    </div>

                    <div className="space-y-3">
                      {groupedColumns.inputs.map((col) => (
                        <div key={col.key} className="space-y-1">
                          <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                            <span>{col.label}</span>
                            <span className="text-gray-400 font-mono text-[10px]">({col.key})</span>
                          </label>
                          <textarea
                            rows={groupedColumns.inputs.length === 1 ? 4 : 3}
                            value={caseFormRow[col.key] || ''}
                            onChange={(e) =>
                              setCaseFormRow({ ...caseFormRow, [col.key]: e.target.value })
                            }
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-mono focus:border-blue-500 bg-white"
                            placeholder={`请输入 ${col.label}...`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. 期望输出 / 期望结果 (Expected) 聚合区块 */}
                {groupedColumns.expecteds.length > 0 && (
                  <div className="space-y-3 bg-emerald-50/20 border border-emerald-100 rounded-xl p-3.5">
                    <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          期望输出 / 期望结果 (Expected)
                        </span>
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200 font-medium">
                          共 {groupedColumns.expecteds.length} 个字段
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400">
                        {editingCase ? '左侧期望值，右侧并列从真实输出匹配对应 key' : '设定标准期望值'}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {groupedColumns.expecteds.map((col) => {
                        const matchResult =
                          editingCase && latestRun?.actual_output
                            ? getMatchedActualValue(col.key, latestRun.actual_output)
                            : { hasMatch: false, valueStr: '' };

                        return (
                          <div
                            key={col.key}
                            className="space-y-1.5 p-3.5 bg-white border border-slate-200/90 rounded-xl shadow-2xs"
                          >
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                              {/* 左侧期望列标题 */}
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                                  <span>{col.label}</span>
                                  <span className="text-gray-400 font-mono text-[10px]">({col.key})</span>
                                  <span className="text-[9px] px-1.5 py-0.2 rounded font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    期望值
                                  </span>
                                </label>
                              </div>

                              {/* 右侧真实输出匹配标题 */}
                              <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-gray-700">真实输出匹配</span>
                                  <span className="text-gray-400 font-mono text-[10px]">({col.key})</span>
                                  {matchResult.hasMatch ? (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
                                      已匹配 Key
                                    </span>
                                  ) : (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-gray-100 text-gray-400 font-normal">
                                      {!editingCase
                                        ? '新增用例'
                                        : !latestRun?.has_run
                                        ? '未运行'
                                        : '无此 Key 或非 JSON'}
                                    </span>
                                  )}
                                </div>

                                {matchResult.hasMatch && (
                                  <button
                                    type="button"
                                    onClick={() => handleAdoptSingleField(col.key, matchResult.valueStr)}
                                    className="text-[11px] text-blue-600 hover:text-blue-800 bg-white hover:bg-blue-50 border border-blue-200 px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-colors shadow-2xs"
                                    title="将真实输出中匹配的该值填入左侧期望框"
                                  >
                                    <ArrowDownLeft className="w-3 h-3" />
                                    <span>采纳填入</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* 期望输入框 与 真实输出匹配框 并列 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* 左框：期望值输入框 */}
                              <textarea
                                rows={4}
                                value={caseFormRow[col.key] || ''}
                                onChange={(e) =>
                                  setCaseFormRow({ ...caseFormRow, [col.key]: e.target.value })
                                }
                                className={`w-full p-2.5 border rounded-lg text-xs font-mono transition-all duration-300 leading-relaxed ${
                                  highlightedColKeys.includes(col.key)
                                    ? 'border-emerald-500 ring-2 ring-emerald-300 bg-emerald-50/30'
                                    : 'border-gray-300 focus:border-blue-500 bg-white'
                                }`}
                                placeholder={`请输入 ${col.label} 期望值...`}
                              />

                              {/* 右框：真实输出匹配框（只读，若非 JSON 或无此字段则展示为空） */}
                              <div className="relative flex flex-col">
                                <textarea
                                  readOnly
                                  rows={4}
                                  value={matchResult.hasMatch ? matchResult.valueStr : ''}
                                  placeholder={
                                    !editingCase
                                      ? '新增用例无运行记录'
                                      : !latestRun?.has_run
                                      ? '该用例尚未运行'
                                      : '输出不是 JSON 或没有该字段展示为空'
                                  }
                                  className={`w-full p-2.5 border rounded-lg text-xs font-mono select-text transition-colors resize-y leading-relaxed ${
                                    matchResult.hasMatch
                                      ? 'bg-white border-slate-300 text-gray-800 shadow-2xs'
                                      : 'bg-gray-100/70 border-dashed border-gray-200 text-gray-400 cursor-default'
                                  }`}
                                />
                                {matchResult.hasMatch && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(matchResult.valueStr);
                                      setCopiedKey(col.key);
                                      setTimeout(() => setCopiedKey(null), 1800);
                                    }}
                                    className="absolute bottom-2 right-2 p-1 text-gray-500 hover:text-gray-700 bg-white/90 rounded border border-gray-200 hover:bg-gray-50 text-[10px] shadow-2xs flex items-center gap-1"
                                    title="复制此匹配值"
                                  >
                                    {copiedKey === col.key ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-600" />
                                        <span className="text-[10px] text-emerald-600 font-medium">已复制</span>
                                      </>
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 3. 扩展元数据 (Metadata) 聚合区块 */}
                {groupedColumns.metadatas.length > 0 && (
                  <div className="space-y-3 bg-purple-50/20 border border-purple-100 rounded-xl p-3.5">
                    <div className="flex items-center justify-between border-b border-purple-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                          扩展元数据 (Metadata)
                        </span>
                        <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200 font-medium">
                          共 {groupedColumns.metadatas.length} 个字段
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400">标签分类或辅助信息</span>
                    </div>

                    <div className="space-y-3">
                      {groupedColumns.metadatas.map((col) => (
                        <div key={col.key} className="space-y-1">
                          <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                            <span>{col.label}</span>
                            <span className="text-gray-400 font-mono text-[10px]">({col.key})</span>
                          </label>
                          <textarea
                            rows={2}
                            value={caseFormRow[col.key] || ''}
                            onChange={(e) =>
                              setCaseFormRow({ ...caseFormRow, [col.key]: e.target.value })
                            }
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-mono focus:border-purple-500 bg-white"
                            placeholder={`请输入 ${col.label}...`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            </div>

            {/* 弹窗底部操作按钮 */}
            <div className="flex items-center justify-between pt-3 border-t">
              <span className="text-[11px] text-gray-400">
                {editingCase
                  ? '期望值右侧已实时匹配真实输出中的对应 key，输出不是 JSON 或无该 key 则展示为空'
                  : '请输入各个列对应的初始测试内容'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCaseModalOpen(false)}
                  className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  form="case-form"
                  className="px-4 py-2 text-xs bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 shadow-sm transition-colors"
                >
                  保存数据行
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 用例集弹窗 */}
      {dsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">{editingDs ? '编辑用例集' : '新建评测用例集'}</h3>
            <form onSubmit={handleSaveDataset} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">用例集名称 *</label>
                <input
                  type="text"
                  required
                  value={dsName}
                  onChange={(e) => setDsName(e.target.value)}
                  placeholder="例如: 客服问答测试集 / 订单流程用例集"
                  className="w-full px-3 py-2 border rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">描述说明</label>
                <textarea
                  rows={3}
                  value={dsDesc}
                  onChange={(e) => setDsDesc(e.target.value)}
                  placeholder="说明样本覆盖的业务边界和测试目标"
                  className="w-full px-3 py-2 border rounded-lg text-xs"
                />
              </div>

              <ScenarioTagEditor
                value={dsScenarioTags}
                onChange={setDsScenarioTags}
                availableTags={availableScenarioTags}
                isResource={true}
                label="场景绑定约束"
                helperText="选择允许使用此用例集的场景标签（默认全场景通用）"
              />
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setDsModalOpen(false)}
                  className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button type="submit" className="px-4 py-2 text-xs bg-blue-600 text-white rounded-lg font-medium">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 批量导入弹窗 */}
      {batchModalOpen && selectedDataset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">批量导入用例行 (JSON 格式)</h3>
            <p className="text-xs text-gray-500">
              请粘贴包含对应表头字段的 JSON 数组。当前列 Key 包括: {currentColumns.map((c) => c.key).join(', ')}
            </p>
            {batchError && (
              <div className="p-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">
                {batchError}
              </div>
            )}
            <form onSubmit={handleBatchImport} className="space-y-4">
              <textarea
                rows={10}
                required
                value={batchJsonText}
                onChange={(e) => setBatchJsonText(e.target.value)}
                className="w-full p-3 font-mono text-xs border rounded-lg bg-gray-50"
              />
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setBatchModalOpen(false)}
                  className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                <button type="submit" className="px-4 py-2 text-xs bg-blue-600 text-white rounded-lg font-medium">
                  确认批量导入
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
