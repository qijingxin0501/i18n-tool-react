import React from 'react';
import { Search, Filter } from 'lucide-react';

interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  showUnfilledOnly: boolean;
  onToggleUnfilled: () => void;
  /** 过滤后的条目数 / 总条目数（用于展示） */
  filteredCount: number;
  totalCount: number;
}

/** 搜索过滤工具栏 */
const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery,
  onSearchChange,
  showUnfilledOnly,
  onToggleUnfilled,
  filteredCount,
  totalCount,
}) => {
  return (
    <div className="bg-white border-b border-slate-200 px-4 py-2">
      <div className="flex items-center gap-3">
        {/* 搜索框 */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索中文内容或文件路径..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 
              focus:outline-none focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300 focus:bg-white
              transition-all placeholder-slate-400"
          />
        </div>

        {/* 仅显示未填开关 */}
        <button
          type="button"
          onClick={onToggleUnfilled}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-all
            ${showUnfilledOnly
              ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 shadow-sm'
              : 'bg-white text-slate-500 border-slate-200 hover:text-slate-700 hover:border-slate-300'
            }`}
        >
          <Filter className="w-3.5 h-3.5" />
          仅显示未填
        </button>

        {/* 筛选结果统计 */}
        <span className="text-[11px] text-slate-400 whitespace-nowrap">
          显示 {filteredCount} / {totalCount} 组
        </span>
      </div>
    </div>
  );
};

export default FilterBar;
