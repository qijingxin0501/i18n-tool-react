import { useEffect, useState, useMemo, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import type { RawMapping } from './types';
import { useMapping } from './hooks/useMapping';
import Header from './components/Header';
import FilterBar from './components/FilterBar';
import GroupRow from './components/GroupRow';

function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnfilledOnly, setShowUnfilledOnly] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const {
    translations,
    groupedData,
    stats,
    handleGroupChange,
    handleItemChange,
    handleSave,
    handleExportUnfilled,
    handleImport,
    initData,
    isSaving,
  } = useMapping();

  // 加载数据
  useEffect(() => {
    fetch('/api/mapping')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: RawMapping) => {
        initData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [initData]);

  // Toast 自动消失
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 搜索防抖
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 过滤后的数据
  const filteredData = useMemo(() => {
    let result = groupedData;

    // 搜索过滤
    if (debouncedQuery.trim()) {
      const query = debouncedQuery.trim().toLowerCase();
      result = result.filter((group) => {
        if (group.zh.toLowerCase().includes(query)) return true;
        return group.items.some((item) =>
          item.filePath.toLowerCase().includes(query)
        );
      });
    }

    // 仅显示未填
    if (showUnfilledOnly) {
      result = result.filter((group) =>
        group.items.some((item) => {
          const key = translations[item.id] || '';
          return key.trim() === '';
        })
      );
    }

    return result;
  }, [groupedData, debouncedQuery, showUnfilledOnly, translations]);

  // 导入成功回调
  const handleImportSuccess = useCallback(
    (count: number) => {
      showToast(`✅ 导入成功，合并了 ${count} 条翻译`);
    },
    [showToast]
  );

  // 保存处理
  const handleSaveClick = useCallback(async () => {
    const confirmed = window.confirm(
      `确认保存？\n\n` +
      `• 当前已填写 ${stats.filled} / ${stats.total} 条 key\n` +
      `• 保存后数据将回写到映射表 JSON 文件\n` +
      `• 保存成功后服务将自动关闭，浏览器页面也会一并关闭`
    );
    if (!confirmed) return;

    try {
      await handleSave();
      showToast('✅ 保存成功！映射表已回写，页面即将关闭...');
      // 延迟关闭，让用户看到 toast
      setTimeout(() => {
        window.close();
      }, 1500);
    } catch (err) {
      showToast(`❌ 保存失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  }, [handleSave, showToast, stats]);

  // 加载状态
  if (loading) {
    return (
      <div className="h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-500">加载映射表数据中...</p>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-md p-6 max-w-md text-center">
          <p className="text-red-600 font-medium mb-2">加载失败</p>
          <p className="text-sm text-slate-500">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition-colors"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-800 font-sans overflow-hidden">
      {/* Toast 提示 */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-slide-in">
          <div className="bg-slate-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
            {toast}
          </div>
        </div>
      )}

      {/* 顶部导航栏 — 固定 */}
      <Header
        stats={stats}
        isSaving={isSaving}
        onSave={handleSaveClick}
        onExportUnfilled={handleExportUnfilled}
        onImport={handleImport}
        onImportSuccess={handleImportSuccess}
      />

      {/* 搜索过滤栏 — 固定 */}
      <FilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showUnfilledOnly={showUnfilledOnly}
        onToggleUnfilled={() => setShowUnfilledOnly((v) => !v)}
        filteredCount={filteredData.length}
        totalCount={groupedData.length}
      />

      {/* 主体列表 — 占据剩余空间，内部虚拟滚动 */}
      <main className="flex-1 min-h-0 px-4 py-4">
        <div className="h-full bg-white rounded-lg shadow-sm border border-slate-200 flex flex-col overflow-hidden">
          {/* 表头 */}
          <div className="grid grid-cols-3 gap-3 p-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 flex-shrink-0">
            <div>扫描出的中文文本</div>
            <div>对应的国际化 Key (留空则不替换)</div>
            <div>智能建议</div>
          </div>

          {/* 虚拟滚动列表 */}
          <div className="flex-1 min-h-0">
            {filteredData.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-400">
                {debouncedQuery || showUnfilledOnly
                  ? '没有匹配的条目'
                  : '暂无数据'}
              </div>
            ) : (
              <Virtuoso
                data={filteredData}
                overscan={200}
                itemContent={(_index, group) => (
                  <div className="border-b border-slate-100 last:border-b-0">
                    <GroupRow
                      group={group}
                      translations={translations}
                      onGroupChange={handleGroupChange}
                      onItemChange={handleItemChange}
                    />
                  </div>
                )}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
