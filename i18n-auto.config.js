/**
 * 国际化自动化脚本配置文件
 * 可根据项目需要修改各项配置
 */
module.exports = {
  // 是否自动从已有词条文件中查找并填充 key
  autoGenerateKey: true,

  // 已有词条 JSON 文件路径（支持嵌套结构）
  existingLocalePath: '../i18n-test-project/src/utils/zh_CN.json',

  // 当多个不同 key 对应同一中文原文时，是否在映射表中输出所有候选 key
  multipleKeysForSameText: true,

  // 翻译方法名称（在代码中调用的函数名）
  translateFuncName: 'intl',

  // 翻译方法的 import 路径
  importPath: '@/utils/tools',

  // 需要扫描的目录（支持数组）
  include: [
    '../i18n-test-project/src',
  ],

  // 需要排除的目录或文件（支持 glob 模式）
  exclude: [
    'node_modules',
    '../i18n-test-project/src/utils/zh_CN.json',
  ],

  // 输出词条 JSON 文件路径
  outputLocalePath: '../i18n-test-project/src/utils/zh_CN.json',

  // 扫描提取和替换阶段使用的映射表文件路径
  mappingPath: '../i18n-test-project/i18n-mapping.json',

  // 输出替换报告的 Markdown 文件路径
  reportPath: '../i18n-test-project/i18n-report.md',
};
