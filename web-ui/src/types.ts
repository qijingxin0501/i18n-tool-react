/** 单条映射项（原始 JSON 中的一个 entry） */
export interface MappingEntry {
  text: string;
  key: string;
  line: number;
  templateExpressions?: string[];
  /** key1, key2 等动态候选字段 */
  [extraKey: string]: unknown;
}

/** 原始 JSON 结构：filePath → entries */
export type RawMapping = Record<string, MappingEntry[]>;

/** 聚合后的显示项（一个 filePath + text 组合） */
export interface AggregatedItem {
  /** 文件路径 */
  filePath: string;
  /** 联合唯一 ID: `${filePath}__${text}` */
  id: string;
  /** 指向原始 entry 的引用 */
  entry: MappingEntry;
}

/** 按中文 text 聚合的分组 */
export interface AggregatedGroup {
  /** 中文原文 */
  zh: string;
  /** 出现次数 */
  count: number;
  /** 所有出现位置 */
  items: AggregatedItem[];
  /** key1, key2 等建议列表（已去重） */
  suggestions: string[];
}
