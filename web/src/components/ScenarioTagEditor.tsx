import React, { useState, useRef } from 'react';
import { parseTags, isUniversalTags } from '../utils/tags';
import { X, Plus, Check } from 'lucide-react';

interface ScenarioTagEditorProps {
  value: string | string[];
  onChange: (tags: string[]) => void;
  availableTags?: string[];
  isResource?: boolean; // If true, provides "全场景通用 (*)" toggle option
  label?: string;
  helperText?: string;
}

export const ScenarioTagEditor: React.FC<ScenarioTagEditorProps> = ({
  value,
  onChange,
  availableTags = [],
  isResource = true,
  label = '场景绑定约束',
  helperText = '仅当场景具有匹配标签时，方可在评测任务中选用此资源',
}) => {
  const currentTags = parseTags(value);
  const isAll = isUniversalTags(currentTags);
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggleUniversal = (checked: boolean) => {
    if (checked) {
      onChange(['*']);
    } else {
      // 从通用转为具体标签，移除 '*'
      const nonUniversal = currentTags.filter(t => t !== '*' && t.toLowerCase() !== 'global');
      onChange(nonUniversal.length > 0 ? nonUniversal : []);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed) return;
    if (isAll) {
      onChange([trimmed]);
      setInputVal('');
      return;
    }
    if (!currentTags.map(t => t.toLowerCase()).includes(trimmed)) {
      onChange([...currentTags.filter(t => t !== '*' && t.toLowerCase() !== 'global'), trimmed]);
    }
    setInputVal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag(inputVal);
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const updated = currentTags.filter(t => t.toLowerCase() !== tagToRemove.toLowerCase());
    onChange(updated);
  };

  const selectableSuggestions = availableTags.filter(
    t => t !== '*' && !currentTags.map(x => x.toLowerCase()).includes(t.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-gray-700">{label}</label>
        {isResource && (
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-gray-600 select-none">
            <input
              type="checkbox"
              checked={isAll}
              onChange={e => handleToggleUniversal(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
            />
            <span>全场景通用 (*)</span>
          </label>
        )}
      </div>

      {(!isResource || !isAll) ? (
        <div className="space-y-2">
          <div className="min-h-[38px] p-1.5 border border-gray-300 rounded-lg bg-white flex flex-wrap items-center gap-1.5 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
            {currentTags
              .filter(t => t !== '*' && t.toLowerCase() !== 'global')
              .map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-blue-900 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}

            <input
              ref={inputRef}
              type="text"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => handleAddTag(inputVal)}
              placeholder={currentTags.length === 0 ? "输入标签后回车添加，如 cron, finance..." : "添加标签..."}
              className="flex-1 min-w-[120px] outline-none text-xs bg-transparent text-gray-800 placeholder-gray-400 py-0.5"
            />
          </div>

          {currentTags.length === 0 && (
            <p className="text-[11px] text-amber-600">
              提示：当前处于特定场景约束模式，请在上方输入标签按回车，或从下方快速选择已有标签。
            </p>
          )}

          {selectableSuggestions.length > 0 && (
            <div className="flex items-center flex-wrap gap-1 text-xs text-gray-500">
              <span className="text-[11px] text-gray-400">已有场景标签快速选择:</span>
              {selectableSuggestions.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleAddTag(tag)}
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 text-[11px] transition"
                >
                  <Plus className="w-2.5 h-2.5" />
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="p-2.5 bg-blue-50/50 border border-blue-200/80 rounded-lg text-xs text-blue-700 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span>当前配置为全场景通用，可供任意评测场景使用。</span>
          </div>
          <button
            type="button"
            onClick={() => handleToggleUniversal(false)}
            className="text-xs text-blue-600 hover:underline font-medium cursor-pointer"
          >
            指定特定场景
          </button>
        </div>
      )}

      {helperText && <p className="text-[11px] text-gray-500">{helperText}</p>}
    </div>
  );
};
