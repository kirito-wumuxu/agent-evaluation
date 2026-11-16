/**
 * 标签解析与场景约束工具函数
 */

export function parseTags(tagsJson?: string | string[]): string[] {
  if (!tagsJson) return [];
  if (Array.isArray(tagsJson)) {
    return tagsJson.map(t => String(t).trim()).filter(Boolean);
  }
  try {
    const parsed = JSON.parse(tagsJson);
    if (Array.isArray(parsed)) {
      return parsed.map(t => String(t).trim()).filter(Boolean);
    }
  } catch {
    // 兼容逗号分隔字符串
    return String(tagsJson)
      .split(/[,，]/)
      .map(t => t.trim())
      .filter(Boolean);
  }
  return [];
}

export function isUniversalTags(tags: string[]): boolean {
  return tags.some(t => t === '*' || t.toLowerCase() === 'global');
}

/**
 * 检查资源（环境、数据集、评测器）是否与指定场景匹配
 */
export function matchScenarioTags(resourceTagsJson?: string | string[], scenarioTagsJson?: string | string[]): boolean {
  const resTags = parseTags(resourceTagsJson);
  const scTags = parseTags(scenarioTagsJson);

  // 资源标记全场景通用
  if (resTags.length === 0 || isUniversalTags(resTags)) {
    return true;
  }

  // 场景未限制或场景全通用
  if (scTags.length === 0 || isUniversalTags(scTags)) {
    return true;
  }

  // 校验标签交集
  const scSet = new Set(scTags.map(t => t.toLowerCase()));
  for (const t of resTags) {
    if (scSet.has(t.toLowerCase())) {
      return true;
    }
  }
  return false;
}
