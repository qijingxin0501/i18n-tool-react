import { useState, useRef, useMemo, useCallback } from 'react';
import type { RawMapping, MappingEntry, AggregatedGroup, AggregatedItem } from '../types';

/** 从 entry 中提取 key1, key2 ... 等建议字段 */
function extractSuggestions(entry: MappingEntry): string[] {
  return Object.keys(entry)
    .filter((k) => /^key\d+$/.test(k))
    .sort()
    .map((k) => entry[k] as string)
    .filter((v) => typeof v === 'string' && v.trim() !== '');
}

/** 构建联合 ID */
function makeId(filePath: string, text: string): string {
  return `${filePath}__${text}`;
}

export interface UseMappingReturn {
  /** 原始数据（保持顺序） */
  rawMapping: RawMapping;
  /** 所有翻译 key 的受控状态 */
  translations: Record<string, string>;
  /** 按 text 聚合并按词频排序的分组 */
  groupedData: AggregatedGroup[];
  /** 统计数据 */
  stats: { total: number; filled: number };
  /** 批量更新同一 text 下所有 item 的 key */
  handleGroupChange: (items: AggregatedItem[], value: string) => void;
  /** 单独更新某个 item 的 key */
  handleItemChange: (id: string, value: string) => void;
  /** 保存到后端 */
  handleSave: () => Promise<void>;
  /** 导出未填项 */
  handleExportUnfilled: () => void;
  /** 导入合并 */
  handleImport: (file: File) => Promise<number>;
  /** 初始化数据 */
  initData: (data: RawMapping) => void;
  /** 保存中状态 */
  isSaving: boolean;
}

export function useMapping(): UseMappingReturn {
  const [rawMapping, setRawMapping] = useState<RawMapping>({});
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // 保留原始 JSON 结构快照，用于导出时保持顺序
  const originalSnapshotRef = useRef<RawMapping>({});

  /** 初始化数据 */
  const initData = useCallback((data: RawMapping) => {
    // 深拷贝保存原始快照
    originalSnapshotRef.current = JSON.parse(JSON.stringify(data));
    setRawMapping(data);

    // 初始化 translations 状态
    const trans: Record<string, string> = {};
    for (const [filePath, entries] of Object.entries(data)) {
      for (const entry of entries) {
        const id = makeId(filePath, entry.text);
        trans[id] = entry.key || '';
      }
    }
    setTranslations(trans);
  }, []);

  /** 按 text 聚合，按词频降序排序 */
  const groupedData = useMemo(() => {
    const groupMap = new Map<string, AggregatedGroup>();

    for (const [filePath, entries] of Object.entries(rawMapping)) {
      for (const entry of entries) {
        const text = entry.text;
        if (!groupMap.has(text)) {
          groupMap.set(text, {
            zh: text,
            count: 0,
            items: [],
            suggestions: [],
          });
        }
        const group = groupMap.get(text)!;
        group.count += 1;
        group.items.push({
          filePath,
          id: makeId(filePath, text),
          entry,
        });

        // 收集建议（去重）
        const suggestions = extractSuggestions(entry);
        for (const s of suggestions) {
          if (!group.suggestions.includes(s)) {
            group.suggestions.push(s);
          }
        }
      }
    }

    // 按词频降序排列
    return Array.from(groupMap.values()).sort((a, b) => b.count - a.count);
  }, [rawMapping]);

  /** 统计 */
  const stats = useMemo(() => {
    const total = Object.values(translations).length;
    const filled = Object.values(translations).filter(
      (v) => v.trim() !== ''
    ).length;
    return { total, filled };
  }, [translations]);

  /** 批量更新 */
  const handleGroupChange = useCallback(
    (items: AggregatedItem[], value: string) => {
      setTranslations((prev) => {
        const next = { ...prev };
        for (const item of items) {
          next[item.id] = value;
        }
        return next;
      });
    },
    []
  );

  /** 单独更新 */
  const handleItemChange = useCallback((id: string, value: string) => {
    setTranslations((prev) => ({ ...prev, [id]: value }));
  }, []);

  /** 保存 */
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // 基于原始快照构建回写数据，仅更新 key
      const output: RawMapping = JSON.parse(
        JSON.stringify(originalSnapshotRef.current)
      );
      for (const [filePath, entries] of Object.entries(output)) {
        for (const entry of entries) {
          const id = makeId(filePath, entry.text);
          if (id in translations) {
            entry.key = translations[id];
          }
        }
      }

      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(output),
      });

      if (!res.ok) {
        throw new Error(`服务端返回 ${res.status}`);
      }
    } finally {
      setIsSaving(false);
    }
  }, [translations]);

  /** 导出未填 */
  const handleExportUnfilled = useCallback(() => {
    const snapshot = originalSnapshotRef.current;
    const result: RawMapping = {};

    // 遍历原始快照，保持原始顺序
    for (const [filePath, entries] of Object.entries(snapshot)) {
      const unfilled = entries.filter((entry) => {
        const id = makeId(filePath, entry.text);
        const currentKey = translations[id] ?? entry.key ?? '';
        return currentKey.trim() === '';
      });
      if (unfilled.length > 0) {
        // 深拷贝条目，更新 key 为当前状态值
        result[filePath] = unfilled.map((entry) => {
          const clone = { ...entry };
          const id = makeId(filePath, entry.text);
          clone.key = translations[id] ?? entry.key ?? '';
          return clone;
        });
      }
    }

    // 下载 JSON 文件
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `i18n-unfilled-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [translations]);

  /** 导入合并 */
  const handleImport = useCallback(
    (file: File): Promise<number> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const importData = JSON.parse(reader.result as string) as RawMapping;
            let mergedCount = 0;

            setTranslations((prev) => {
              const next = { ...prev };
              for (const [filePath, entries] of Object.entries(importData)) {
                for (const entry of entries) {
                  const id = makeId(filePath, entry.text);
                  const importedKey = entry.key?.trim() ?? '';
                  // 仅合并有值的 key，且不覆盖已填项
                  if (importedKey !== '' && (!(id in next) || next[id].trim() === '')) {
                    next[id] = importedKey;
                    mergedCount++;
                  }
                }
              }
              return next;
            });

            resolve(mergedCount);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
    },
    []
  );

  return {
    rawMapping,
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
  };
}
