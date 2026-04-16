import React from 'react';
import { Sparkles } from 'lucide-react';

interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (value: string) => void;
  /** 紧凑尺寸用于内层 */
  compact?: boolean;
}

/** 智能建议标签组件 */
const SuggestionChips: React.FC<SuggestionChipsProps> = ({
  suggestions,
  onSelect,
  compact = false,
}) => {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`text-slate-400 flex items-center gap-0.5 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
        <Sparkles className="w-3 h-3" />
        建议:
      </span>
      {suggestions.map((suggestion, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => onSelect(suggestion)}
          className={`font-mono rounded border transition-colors active:scale-95
            ${compact
              ? 'px-1 py-px bg-white text-indigo-500 border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 text-[10px] shadow-sm'
              : 'px-1.5 py-0.5 bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100 text-[11px]'
            }`}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
};

export default SuggestionChips;
