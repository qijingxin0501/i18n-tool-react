# i18n-auto

`i18n-auto` 是一个自动化国际化代码改造工具。它旨在解决老旧项目中大量中文字符串需要手动提取、翻译并用国际化函数替换的繁琐工作。本工具通过 AST（抽象语法树）解析代码，精准提取中文，生成多语言映射表，并在人工核对 key 后，自动完成代码的无感替换。

## 特性

- 🚀 **AST 驱动**：使用 Babel 解析 AST，精准识别字符串、模板字符串、JSX 文本、JSX 属性。
- 🛡️ **安全过滤**：自动忽略 `console.log/error/warn` 中的中文，自动忽略 `===`、`!==` 等逻辑比较表达式中的中文，避免破坏代码逻辑。
- 🧩 **智能合并**：支持将 JSX 混合文本和 `+` 号字符串拼接合并为带 `${n}` 占位符的单条翻译记录。
- 📝 **智能复用**：扫描时自动匹配项目中已有的多语言词条（支持基于拼音的模糊匹配），减少重复翻译。
- 🔄 **结构保留**：如果被替换点需要引入多语言函数，在对应文件顶部自动注入 `import`。

---

## 目录结构说明

```text
i18n-tool-react/
├── i18n-auto.js            # 主入口文件，执行 extract / replace / sync / ui 命令
├── i18n-auto.config.js     # 核心配置文件，配置扫描路径和翻译函数
├── i18n-mapping.json       # 自动生成的翻译映射表（需人工填 key，路径可通过 mappingPath 配置）
├── i18n-report.md          # 每次 replace 执行后的统计报告
├── src/
│   ├── ast-core.js         # AST 解析核心逻辑（含提取规则）
│   ├── extract.js          # extract 阶段的扫描与匹配逻辑
│   ├── replace.js          # replace 阶段的代码替换和注入逻辑
│   ├── report.js           # 替换报告生成逻辑
│   ├── sync.js             # sync 阶段的词条同步逻辑
│   └── ui.js               # ui 阶段的可视化工作台服务端逻辑
├── web-ui/                 # 可视化配置工作台前端工程 (Vite + React + TypeScript + Tailwind CSS)
│   ├── src/
│   │   ├── App.tsx          # 根组件（虚拟滚动列表）
│   │   ├── hooks/useMapping.ts  # 核心状态管理 Hook
│   │   └── components/      # UI 组件（Header, FilterBar, GroupRow, SuggestionChips）
│   └── dist/               # 构建产物（由 ui 命令自动生成）
```

---

## 配置说明 (`i18n-auto.config.js`)

每次执行前，请检查配置是否匹配当前开发需求：

```javascript
module.exports = {
  // 当前项目中已有的中英文词条 JSON 路径
  existingLocalePath: '../src/locale/zh_CN.json',
  
  // 提取出的新词条最终合并写入该文件
  outputLocalePath: '../src/locale/zh_CN.json',

  // 是否自动从已有词条文件中匹配相似文本并默认填充到 key 字段
  autoGenerateKey: true,

  // 待扫描/替换的目录或文件数组（支持 glob 表达式，基于当前配置文件的相对路径）
  include: [
    '../src/pages/business/**/*.js',
    '../src/components/MyComponent.js'
  ],

  // 排除目录
  exclude: [
    '**/node_modules/**',
    '**/*.test.js'
  ],

  // 提取出的中文要被替换成的函数名称
  translateFuncName: 'intl',

  // 注入到文件头部的引用路径，如果为空字符串则不自动注入 import
  importPath: '@/locale/tools',

  // 扫描提取和替换阶段使用的映射表文件路径（默认为当前目录下的 i18n-mapping.json）
  mappingPath: './i18n-mapping.json',

  // 输出替换报告的 Markdown 文件路径
  reportPath: './i18n-report.md',
};
```

---

## intl 自定义方法占位

在替换阶段，工具会将中文替换为你配置的 `translateFuncName` 函数（如 `intl`）。因为不同项目的底层 i18n 实现方案不同，你需要自行在你的项目中（通常是在提取出的公共 `tools.js` 或类似库中）提供这个 `intl` 方法。

**请参考以下结构完善你的 `intl` 方法：**

```javascript
const i18n = window?.xxx_i18n ? window.xxx_i18n : (_key, defaultText) => { return defaultText };

/**
 * 国际化翻译函数
 * 通过 key 从词条文件中获取翻译文本，并将 ${0}、${1}... 占位符替换为实际值
 *
 * @param {object} params - 翻译参数
 * @param {string} params.key - 词条 key，如 'common.confirm'
 * @param {string} params.defaultText - 默认文本，当 key 未匹配到词条时使用
 * @param {Array} [params.values] - 变量值数组，按顺序替换文本中的 ${0}、${1}... 占位符
 * @returns {string} 翻译后的文本
 *
 * @example
 * // 普通翻译
 * intl({ key: 'common.confirm', defaultText: '确认' })
 * // → "确认"（或对应语言的翻译）
 *
 * @example
 * // 带变量的翻译
 * intl({ key: 'order.summary', defaultText: '共 ${0} 条，成功 ${1} 条', values: [100, 98] })
 * // → "共 100 条，成功 98 条"
 */
export const intl = ({ key, defaultText, values }) => {
  // 通过 i18n 获取翻译文本，如果没有匹配到则使用 defaultText
  const text = i18n(key, defaultText) || defaultText;

  // 如果没有变量需要替换，直接返回
  if (!values || values.length === 0) {
    return text;
  }

  // 将 ${0}、${1}、${2}... 占位符替换为 values 中对应的值
  return text.replace(/\$\{(\d+)\}/g, (match, index) => {
    const i = parseInt(index, 10);
    return i < values.length ? values[i] : match;
  });
};
```

---

## 使用步骤

请参考文档 [**中文化改造自动化脚本使用手册**](./docs/中文化改造自动化脚本使用手册.md) 以获取详细的图文教程和最佳实践。

大致流程如下：
1. **核对配置**：修改 `i18n-auto.config.js` 的扫描目标 `include`
2. **扫描提取**：执行 `node i18n-auto.js extract`
3. **可视化编排（推荐）**：执行 `node i18n-auto.js ui`，启动本地可视化工作台，在浏览器中批量管理映射表。支持按词频聚合、智能建议、搜索过滤、批量/独立编辑、导入/导出等功能。
4. **人工编排（备选）**：也可直接打开映射表文件（默认 `i18n-mapping.json`），手动编辑 `key` 属性。
5. **一键替换**：执行 `node i18n-auto.js replace`
6. **词条同步**：执行 `node i18n-auto.js sync`，扫描代码中已替换的 `intl()` 调用，将缺失的 key 自动回填到词条 JSON 文件中。
7. **代码格式化**：视需要执行项目的 eslint 或 prettier 等工具修复格式。
