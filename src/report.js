/**
 * 报告生成模块
 * 生成 Markdown 格式的替换报告
 */
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

/**
 * 生成 Markdown 替换报告
 * @param {object} replaceResult - replace 阶段返回的结果
 * @param {string} reportPath - 报告输出路径
 */
function generateReport(replaceResult, reportPath) {
  const { stats, skippedItems, errors } = replaceResult;
  const outputPath = path.resolve(reportPath);

  let md = '';

  // 标题
  md += '# 国际化替换报告\n\n';
  md += `> 生成时间：${new Date().toLocaleString('zh-CN')}\n\n`;

  // 统计信息
  md += '## 📊 统计信息\n\n';
  md += `| 指标 | 数值 |\n`;
  md += `| --- | --- |\n`;
  md += `| 扫描文件总数 | ${stats.totalFiles} |\n`;
  md += `| 成功替换数 | ${stats.totalReplaced} |\n`;
  md += `| 未替换条目数 | ${stats.totalSkipped} |\n`;
  md += `| 错误文件数 | ${stats.totalErrors} |\n`;
  md += '\n';

  // 未替换条目列表
  if (skippedItems.length > 0) {
    md += '## ⚠️ 未替换条目列表\n\n';
    md += '| 文件路径 | 行号 | 原文 | 原因 |\n';
    md += '| --- | --- | --- | --- |\n';
    for (const item of skippedItems) {
      // 转义管道符
      const text = item.text.replace(/\|/g, '\\|');
      md += `| ${item.file} | ${item.line} | ${text} | ${item.reason} |\n`;
    }
    md += '\n';
  }

  // 错误信息
  if (errors.length > 0) {
    md += '## ❌ 错误信息\n\n';
    for (const err of errors) {
      md += `### ${err.file}\n\n`;
      md += `\`\`\`\n${err.error}\n\`\`\`\n\n`;
    }
    md += '### 处理建议\n\n';
    md += '- 检查上述文件是否存在语法错误\n';
    md += '- 确认文件编码为 UTF-8\n';
    md += '- 尝试手动修复后重新运行替换\n';
    md += '\n';
  }

  // 无问题时的提示
  if (skippedItems.length === 0 && errors.length === 0) {
    md += '## ✅ 全部替换成功\n\n';
    md += '所有中文条目已成功替换为翻译函数调用。\n\n';
  }

  // 写入文件
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, md, 'utf-8');
  console.log(chalk.green(`📋 替换报告已生成：${outputPath}\n`));
}

module.exports = { generateReport };
