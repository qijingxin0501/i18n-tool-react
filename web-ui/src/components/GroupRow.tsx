import React, { useState } from 'react';
import {
  FileText,
  ChevronDown,
  ChevronUp,
  SplitSquareHorizontal,
} from 'lucide-react';
import type { AggregatedGroup, AggregatedItem } from '../types';
import SuggestionChips from './SuggestionChips';

interface GroupRowProps {
  group: AggregatedGroup;
  translations: Record<string, string>;
  onGroupChange: (items: AggregatedItem[], value: string) => void;
  onItemChange: (id: string, value: string) => void;
}

/** 词条行组件（外层批量区 + 内层独立区） */
const GroupRow: React.FC<GroupRowProps> = ({
  group,
  translations,
  onGroupChange,
  onItemChange,
}) => {
  const [expanded, setExpanded] = useState(false);

  // 计算当前组的 key 状态
  const groupKeys = group.items.map((item) => translations[item.id] || '');
  const allSame = groupKeys.every((k) => k === groupKeys[0]);
  const groupValue = allSame ? groupKeys[0] : '';
  const isFilled = groupValue.trim() !== '';
  const isMixed = !allSame && groupKeys.some((k) => k !== '');

  return (
    <div
      className={`flex flex-col transition-colors ${
        isFilled || isMixed ? 'bg-indigo-50/20' : 'hover:bg-slate-50'
      }`}
    >
      {/* 外层批量区 — 三列等宽 */}
      <div className="grid grid-cols-3 gap-3 px-4 py-3">
        {/* 第一列：中文 text + 词频 + 展开按钮 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <span className="text-sm font-semibold text-slate-900 leading-tight break-all">
              "{group.zh}"
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-px rounded text-[11px] font-medium whitespace-nowrap flex-shrink-0
                ${
                  group.count > 1
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
            >
              {group.count > 1 ? '🔥 ' : ''}
              {group.count} 处
            </span>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-600 transition-colors"
            >
              <FileText className="w-3 h-3" />
              {expanded
                ? '收起位置'
                : `展开 ${group.count} 个文件位置独立修改`}
              {expanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>

        {/* 第二列：全局 Key Input */}
        <div className="flex flex-col justify-center">
          <div className="relative flex items-center">
            <input
              type="text"
              value={isMixed ? '' : groupValue}
              onChange={(e) => onGroupChange(group.items, e.target.value)}
              placeholder={
                isMixed
                  ? '（已独立拆分，请在下方管理）'
                  : '输入 Key 批量应用至所有文件'
              }
              className={`w-full px-3 py-1.5 bg-white border rounded shadow-sm text-xs font-mono transition-all 
                focus:outline-none focus:ring-1 focus:border-transparent
                ${
                  isMixed
                    ? 'border-amber-300 bg-amber-50 placeholder-amber-600 focus:ring-amber-200'
                    : isFilled
                    ? 'border-indigo-300 focus:ring-indigo-200'
                    : 'border-slate-300 focus:ring-slate-200'
                }`}
            />
            {isMixed && (
              <div
                className="absolute right-2 text-amber-500"
                title="已拆分，禁用统一展示"
              >
                <SplitSquareHorizontal className="w-4 h-4" />
              </div>
            )}
          </div>
        </div>

        {/* 第三列：全局建议 */}
        <div className="flex flex-col justify-center">
          {!isMixed && !isFilled && group.suggestions.length > 0 ? (
            <SuggestionChips
              suggestions={group.suggestions}
              onSelect={(value) => onGroupChange(group.items, value)}
            />
          ) : isFilled ? (
            <span className="text-[11px] text-emerald-500">✓ 已填写</span>
          ) : isMixed ? (
            <span className="text-[11px] text-amber-500">⚠ 已拆分</span>
          ) : group.suggestions.length === 0 ? (
            <span className="text-[11px] text-slate-300">暂无建议</span>
          ) : null}
        </div>
      </div>

      {/* 内层独立输入区 — 三列对齐 */}
      {expanded && (
        <div className="bg-slate-50 border-t border-slate-100 px-4 py-2 shadow-inner space-y-1.5">
          {group.items.map((item, index) => {
            const itemKey = translations[item.id] || '';
            return (
              <div
                key={item.id}
                className="grid grid-cols-3 gap-3 pl-3 border-l-2 border-indigo-200 py-1"
              >
                {/* 第一列：文件路径 */}
                <div
                  className="text-[11px] text-slate-500 font-mono truncate pt-1.5"
                  title={item.filePath}
                >
                  <span className="text-slate-400 mr-1">
                    {index + 1}.
                  </span>
                  {item.filePath}
                </div>

                {/* 第二列：独立 Key Input */}
                <div className="flex flex-col justify-center">
                  <input
                    type="text"
                    value={itemKey}
                    onChange={(e) =>
                      onItemChange(item.id, e.target.value)
                    }
                    placeholder="留空则跳过替换"
                    className={`w-full px-2 py-1 text-[11px] font-mono border rounded bg-white 
                      focus:outline-none focus:ring-1 focus:ring-indigo-300
                      ${
                        itemKey
                          ? 'border-indigo-300 text-indigo-700 bg-indigo-50/30'
                          : 'border-slate-200'
                      }`}
                  />
                </div>

                {/* 第三列：独立建议 */}
                <div className="flex flex-col justify-center">
                  {!itemKey && group.suggestions.length > 0 && (
                    <SuggestionChips
                      suggestions={group.suggestions}
                      onSelect={(value) => onItemChange(item.id, value)}
                      compact
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GroupRow;
