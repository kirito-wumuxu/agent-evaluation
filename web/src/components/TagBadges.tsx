import React from 'react';
import { parseTags, isUniversalTags } from '../utils/tags';

interface TagBadgesProps {
  tags?: string | string[];
  maxDisplay?: number;
  className?: string;
}

export const TagBadges: React.FC<TagBadgesProps> = ({ tags, maxDisplay = 3, className = '' }) => {
  const parsed = parseTags(tags);

  if (parsed.length === 0 || isUniversalTags(parsed)) {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 ${className}`}>
        全场景通用 (*)
      </span>
    );
  }

  const displayList = parsed.slice(0, maxDisplay);
  const remaining = parsed.length - maxDisplay;

  return (
    <div className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {displayList.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200"
        >
          #{tag}
        </span>
      ))}
      {remaining > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs text-gray-500 bg-gray-50 border border-gray-200">
          +{remaining}
        </span>
      )}
    </div>
  );
};
