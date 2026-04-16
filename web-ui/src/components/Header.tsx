import React, { useRef } from 'react';
import { Sparkles, CheckCircle2, Download, Upload, Save } from 'lucide-react';

interface HeaderProps {
  stats: { total: number; filled: number };
  isSaving: boolean;
  onSave: () => void;
  onExportUnfilled: () => void;
  onImport: (file: File) => Promise<number>;
  /** 导入成功后的回调，传入合并数量 */
  onImportSuccess?: (count: number) => void;
}

/** 顶部导航栏 */
const Header: React.FC<HeaderProps> = ({
  stats,
  isSaving,
  onSave,
  onExportUnfilled,
  onImport,
  onImportSuccess,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerImport = () => {
    fileInputRef.current?.click();
  };

  const handleImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const count = await onImport(file);
      onImportSuccess?.(count);
    } catch (err) {
      alert(`导入失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
    // 重置 file input，允许重复选择同一文件
    e.target.value = '';
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            I18n 可视化配置工作台
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            支持批量覆盖、单文件拆分独立命名以及导入/导出异步协作
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* 统计 */}
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
              <CheckCircle2 className="w-3.5 h-3.5" />
              已填: {stats.filled} / {stats.total}
            </span>
          </div>

          {/* 导入导出 */}
          <div className="flex items-center gap-1 border-r border-slate-200 pr-4">
            <button
              type="button"
              onClick={onExportUnfilled}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
              title="导出尚未填写的词条为 JSON，发给翻译人员"
            >
              <Download className="w-3.5 h-3.5" />
              导出未填
            </button>

            <button
              type="button"
              onClick={triggerImport}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
              title="导入翻译人员填好的 JSON 并合并"
            >
              <Upload className="w-3.5 h-3.5" />
              导入合并
            </button>
            <input
              type="file"
              accept=".json"
              ref={fileInputRef}
              onChange={handleImportChange}
              className="hidden"
            />
          </div>

          {/* 保存按钮 */}
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium text-white shadow-sm transition-all
              ${isSaving
                ? 'bg-indigo-400 cursor-wait'
                : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95'
              }`}
          >
            <Save className="w-3.5 h-3.5" />
            {isSaving ? '正在回写...' : '保存至 mapping.json'}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
