/**
 * replace 阶段模块
 * 读取映射表，执行代码替换及 import 注入
 */
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const readline = require('readline');
const MagicString = require('magic-string');
const { parseCode, extractChinese, CHINESE_RE } = require('./ast-core');
const traverse = require('@babel/traverse').default;

/**
 * 生成翻译函数调用的代码字符串
 * @param {string} key - 翻译 key
 * @param {string} defaultText - 默认文本
 * @param {string} funcName - 翻译函数名
 * @param {string[]} [templateExpressions] - 模板表达式列表
 * @returns {string} 函数调用代码
 */
function buildTranslateCall(key, defaultText, funcName, templateExpressions) {
  let call = `${funcName}({ key: '${key}', defaultText: '${defaultText}'`;
  if (templateExpressions && templateExpressions.length > 0) {
    call += `, values: [${templateExpressions.join(', ')}]`;
  }
  call += ' })';
  return call;
}

/**
 * 处理模板表达式中残留的中文，将它们替换为翻译函数调用
 *
 * 支持两种场景：
 *
 * 场景一：嵌套模板字符串
 *   表达式源码: num ? `${num}条已缴费` : ""
 *   映射条目:   { text: "${0}条已缴费", templateExpressions: ["num"], key: "header.bbb" }
 *   → 还原源码: `${num}条已缴费`
 *   → 替换结果: num ? intl({ key: 'header.bbb', defaultText: '${0}条已缴费', values: [num] }) : ""
 *
 * 场景二：普通引号字符串
 *   表达式源码: getConfig("idEmp121_2", "首席医生")
 *   映射条目:   { text: "首席医生", key: "xxx" }
 *   → 替换结果: getConfig("idEmp121_2", intl({ key: 'xxx', defaultText: '首席医生' }))
 *
 * @param {string} expr - 原始表达式源码
 * @param {Map} textToEntry - 文本到映射条目的映射
 * @param {string} funcName - 翻译函数名
 * @returns {string} 处理后的表达式
 */
function translateExpressionChinese(expr, textToEntry, funcName) {
  let result = expr;
  for (const [text, entry] of textToEntry) {
    if (!CHINESE_RE.test(text)) continue;
    if (!entry.key || entry.key.trim() === '') continue;

    // —— 场景一：嵌套模板字符串 ——
    // 条目含占位符且有 templateExpressions 信息，说明是从嵌套模板中提取的
    if (text.includes('${') && entry.templateExpressions && entry.templateExpressions.length > 0) {
      // 1. 将映射中的占位符 ${0}, ${1} ... 还原为实际变量名
      //    "${0}条已缴费" + ["num"] → "${num}条已缴费"
      let templateSource = text;
      for (let i = 0; i < entry.templateExpressions.length; i++) {
        // 使用 split/join 避免 String.replace 中 $ 的特殊含义
        templateSource = templateSource
          .split(`\${${i}}`)
          .join(`\${${entry.templateExpressions[i]}}`);
      }

      // 2. 加上反引号，还原为完整的模板字符串源码形式
      //    "${num}条已缴费" → `${num}条已缴费`
      const backtickSource = '`' + templateSource + '`';

      // 3. 在表达式中查找并替换为 intl() 调用
      if (result.includes(backtickSource)) {
        const call = buildTranslateCall(
          entry.key, text, funcName, entry.templateExpressions
        );
        result = result.replaceAll(backtickSource, call);
      }
      continue;
    }

    // 含占位符但缺少 templateExpressions 信息的条目无法还原，跳过
    if (text.includes('${')) continue;

    // —— 场景二：普通引号字符串 ——
    const call = buildTranslateCall(entry.key, text, funcName);

    // 尝试匹配双引号 "中文" 或单引号 '中文'
    const doubleQuoted = `"${text}"`;
    if (result.includes(doubleQuoted)) {
      result = result.replaceAll(doubleQuoted, call);
      continue;
    }
    const singleQuoted = `'${text}'`;
    if (result.includes(singleQuoted)) {
      result = result.replaceAll(singleQuoted, call);
    }
  }
  return result;
}

/**
 * 对模板表达式列表进行中文翻译处理
 * @param {string[]} expressions - 模板表达式的源码列表
 * @param {Map} textToEntry - 文本到映射条目的映射
 * @param {string} funcName - 翻译函数名
 * @returns {string[]} 处理后的表达式列表
 */
function processTemplateExpressions(expressions, textToEntry, funcName) {
  if (!expressions || expressions.length === 0) return expressions;
  return expressions.map((expr) =>
    translateExpressionChinese(expr, textToEntry, funcName)
  );
}

/**
 * 处理 import 注入
 * - 如果文件已有 importPath 的 import 但缺少 translateFuncName，追加该标识符
 * - 如果没有任何相关 import，在文件头部插入
 * @param {MagicString} ms - MagicString 实例
 * @param {object} ast - AST 对象
 * @param {string} code - 源代码
 * @param {string} funcName - 翻译函数名
 * @param {string} importPath - import 路径
 * @returns {boolean} 是否进行了 import 操作
 */
function handleImport(ms, ast, code, funcName, importPath) {
  let hasImportPath = false;
  let hasFuncImport = false;
  let targetImportNode = null;

  // 遍历顶层 import 声明
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.source.value === importPath) {
      hasImportPath = true;
      targetImportNode = node;
      // 检查是否已导入目标函数
      for (const spec of node.specifiers) {
        if (
          spec.type === 'ImportSpecifier' &&
          spec.imported &&
          spec.imported.name === funcName
        ) {
          hasFuncImport = true;
          break;
        }
      }
      break;
    }
  }

  if (hasFuncImport) {
    // 已经有正确的 import，无需处理
    return false;
  }

  if (hasImportPath && targetImportNode) {
    // 有 importPath 但缺少 funcName，追加
    const specifiers = targetImportNode.specifiers;
    if (specifiers.length > 0) {
      // 在最后一个 specifier 之后追加
      const lastSpec = specifiers[specifiers.length - 1];
      ms.appendLeft(lastSpec.end, `, ${funcName}`);
    } else {
      // 没有任何 specifier（理论上不太可能）
      // 改写整个 import 语句
      ms.overwrite(
        targetImportNode.start,
        targetImportNode.end,
        `import { ${funcName} } from '${importPath}';`
      );
    }
    return true;
  }

  // 完全没有相关 import，在文件头部插入
  // 检测源文件换行符类型（兼容 Windows CRLF）
  const lineEnd = code.includes('\r\n') ? '\r\n' : '\n';
  const importStatement = `import { ${funcName} } from '${importPath}';${lineEnd}`;

  // 找到第一个非注释语句的位置，或者文件头部
  let insertPos = 0;
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      // 在最后一个 import 之后插入
      insertPos = node.end;
      // 检查之后是否有换行（兼容 Windows 的 \r\n）
      if (code[insertPos] === '\r' && code[insertPos + 1] === '\n') {
        insertPos += 2;
      } else if (code[insertPos] === '\n') {
        insertPos += 1;
      }
    } else {
      break;
    }
  }

  if (insertPos === 0) {
    // 文件没有任何 import，在最开头插入
    ms.prepend(importStatement);
  } else {
    ms.appendLeft(insertPos, importStatement);
  }

  return true;
}

/**
 * 替换单个文件中的中文字符串
 * @param {string} filePath - 文件路径
 * @param {Array<object>} mappingEntries - 该文件的映射表条目
 * @param {object} config - 配置
 * @returns {{ replaced: number, skipped: Array<object>, error: string|null }}
 */
function replaceFile(filePath, mappingEntries, config) {
  const result = { replaced: 0, skipped: [], error: null };

  try {
    const code = fs.readFileSync(filePath, 'utf-8');
    const ast = parseCode(code, filePath);
    const ms = new MagicString(code);

    // 构建映射：text -> { key, templateExpressions }
    const textToEntry = new Map();
    for (const entry of mappingEntries) {
      textToEntry.set(entry.text, entry);
    }

    // 再次提取当前文件中的中文（获取精准坐标）
    const currentItems = extractChinese(code, filePath, config.translateFuncName);

    // 标记是否有成功替换（用于决定是否注入 import）
    let hasReplacement = false;

    // 倒序替换（从文件末尾开始），避免坐标偏移问题
    // 实际上 magic-string 内部处理了偏移，但为安全起见仍然倒序
    const sortedItems = [...currentItems].sort((a, b) => b.start - a.start);

    // 识别被模板/拼接/混合类型覆盖的子项，跳过它们以避免 MagicString 范围冲突
    const containerTypes = new Set(['template', 'jsx-template', 'jsx-mixed', 'string-concat']);
    const containerItems = sortedItems.filter((item) => containerTypes.has(item.type));
    const containedStarts = new Set();
    for (const cItem of containerItems) {
      for (const sItem of sortedItems) {
        if (sItem === cItem) continue;
        // 如果子项的范围完全在容器项内，标记为被包含
        if (sItem.start >= cItem.start && sItem.end <= cItem.end) {
          containedStarts.add(sItem.start);
        }
      }
    }

    for (const item of sortedItems) {
      // 跳过被模板/拼接/混合类型包含的子项（由容器项统一处理）
      if (containedStarts.has(item.start)) continue;

      const entry = textToEntry.get(item.text);

      if (!entry) {
        // 文本在映射中不存在（可能被用户删除）
        result.skipped.push({
          file: filePath,
          line: item.line,
          text: item.text,
          reason: '条目被删除',
        });
        continue;
      }

      if (!entry.key || entry.key.trim() === '') {
        // 用户未配置 key
        result.skipped.push({
          file: filePath,
          line: item.line,
          text: item.text,
          reason: 'key 未填写',
        });
        continue;
      }

      // 构建替换字符串
      const translateCall = buildTranslateCall(
        entry.key,
        entry.text,
        config.translateFuncName,
        entry.templateExpressions
      );

      // 根据节点类型决定替换方式
      switch (item.type) {
        case 'string': {
          // 普通字符串：'确认' → intl({ key: 'xxx', defaultText: '确认' })
          ms.overwrite(item.start, item.end, translateCall);
          break;
        }
        case 'jsx-attr': {
          // JSX 属性值：title="提示" → title={intl({ key: 'xxx', defaultText: '提示' })}
          ms.overwrite(item.start, item.end, `{${translateCall}}`);
          break;
        }
        case 'jsx-text': {
          // JSX 文本节点：确认 → {intl({ key: 'xxx', defaultText: '确认' })}
          ms.overwrite(item.start, item.end, `{${translateCall}}`);
          break;
        }
        case 'jsx-expr': {
          // JSX 表达式中的字符串，已在 {} 内，直接替换
          ms.overwrite(item.start, item.end, translateCall);
          break;
        }
        case 'jsx-mixed': {
          // JSX 混合文本+表达式序列，整体替换为 {intl(...)}
          // 处理表达式中可能包含的中文字符串
          const processedExprs = processTemplateExpressions(
            item.templateExpressions,
            textToEntry,
            config.translateFuncName
          );
          const mixedCall = buildTranslateCall(
            entry.key,
            entry.text,
            config.translateFuncName,
            processedExprs
          );
          ms.overwrite(item.start, item.end, `{${mixedCall}}`);
          break;
        }
        case 'string-concat': {
          // 字符串拼接：("前缀" + expr + "后缀") → intl({ key, defaultText, values: [...] })
          // 处理表达式中可能包含的中文字符串
          const processedExprs = processTemplateExpressions(
            item.templateExpressions,
            textToEntry,
            config.translateFuncName
          );
          const concatCall = buildTranslateCall(
            entry.key,
            entry.text,
            config.translateFuncName,
            processedExprs
          );
          ms.overwrite(item.start, item.end, concatCall);
          break;
        }
        case 'template':
        case 'jsx-template': {
          // 模板字符串（jsx-template 已在 JSXExpressionContainer 的 {} 内，不需要额外包裹）
          // 处理表达式中可能包含的中文字符串
          const processedExprs = processTemplateExpressions(
            item.templateExpressions,
            textToEntry,
            config.translateFuncName
          );
          const call = buildTranslateCall(
            entry.key,
            item.text,
            config.translateFuncName,
            processedExprs
          );
          ms.overwrite(item.start, item.end, call);
          break;
        }
        default:
          ms.overwrite(item.start, item.end, translateCall);
      }

      hasReplacement = true;
      result.replaced++;

      // 从 textToEntry 中标记已使用（避免同一文件中重复文本都替换到同一个 key）
      // 注意：不删除，因为多处出现相同文本应该使用相同 key
    }

    // 注入 import 语句
    if (hasReplacement) {
      handleImport(ms, ast, code, config.translateFuncName, config.importPath);
    }

    // 写回文件
    if (hasReplacement) {
      fs.writeFileSync(filePath, ms.toString(), 'utf-8');
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

/**
 * 执行 replace 阶段
 * @param {object} config - 配置
 * @returns {{ stats: object, skippedItems: Array, errors: Array }}
 */
async function replace(config) {
  console.log(chalk.cyan('\n🔄 开始替换阶段...\n'));

  // 1. 读取映射表（路径由 config.mappingPath 配置）
  const mappingPath = path.resolve(config.mappingPath || 'i18n-mapping.json');
  if (!fs.existsSync(mappingPath)) {
    console.log(
      chalk.red(`❌ 找不到映射表文件 ${mappingPath}，请先运行 extract 阶段。`)
    );
    process.exit(1);
  }

  let mapping;
  try {
    mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
  } catch (err) {
    console.log(
      chalk.red(`❌ 无法解析映射表文件 ${path.basename(mappingPath)}：${err.message}`)
    );
    process.exit(1);
  }

  const filePaths = Object.keys(mapping);
  console.log(chalk.blue(`📂 待处理文件：${filePaths.length} 个`));

  // 安全确认：提醒用户此操作会直接修改源文件
  const confirmed = await new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    console.log('');
    console.log(chalk.yellow.bold('⚠️  注意：此操作将直接修改源代码文件，且不可自动撤销。'));
    console.log(chalk.yellow('   请确保目标目录中的文件已保存，并已通过 Git 提交或暂存，以便在需要时可以回退。'));
    console.log('');
    rl.question(chalk.white('是否继续执行替换？(y/N) '), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });

  if (!confirmed) {
    console.log(chalk.yellow('\n⚠️  已取消替换操作。\n'));
    process.exit(0);
  }

  // 2. 逐文件替换
  const allSkipped = [];
  const allErrors = [];
  let totalReplaced = 0;

  for (const filePath of filePaths) {
    const entries = mapping[filePath];
    if (!entries || entries.length === 0) continue;

    const result = replaceFile(filePath, entries, config);

    totalReplaced += result.replaced;
    allSkipped.push(...result.skipped);

    if (result.error) {
      allErrors.push({ file: filePath, error: result.error });
      console.log(chalk.red(`  ✗ ${filePath}：替换失败 - ${result.error}`));
    } else {
      const skipCount = result.skipped.length;
      if (result.replaced > 0) {
        console.log(
          chalk.green(`  ✓ ${filePath}：替换 ${result.replaced} 条`) +
            (skipCount > 0
              ? chalk.yellow(`，跳过 ${skipCount} 条`)
              : '')
        );
      } else if (skipCount > 0) {
        console.log(
          chalk.yellow(`  ⚠ ${filePath}：全部跳过（${skipCount} 条）`)
        );
      }
    }
  }

  // 3. 生成最终词条文件
  generateLocaleFile(mapping, config);

  console.log(chalk.cyan('\n📊 替换结果汇总：'));
  console.log(chalk.white(`   处理文件数：${filePaths.length}`));
  console.log(chalk.green(`   成功替换数：${totalReplaced}`));
  console.log(chalk.yellow(`   未替换条目数：${allSkipped.length}`));
  if (allErrors.length > 0) {
    console.log(chalk.red(`   错误文件数：${allErrors.length}`));
  }

  return {
    stats: {
      totalFiles: filePaths.length,
      totalReplaced,
      totalSkipped: allSkipped.length,
      totalErrors: allErrors.length,
    },
    skippedItems: allSkipped,
    errors: allErrors,
  };
}

/**
 * 根据映射表生成最终词条 JSON 文件
 * @param {object} mapping - 映射表
 * @param {object} config - 配置
 */
function generateLocaleFile(mapping, config) {
  const outputPath = path.resolve(config.outputLocalePath);

  // 收集所有有效的 key-text 对
  const keyTextPairs = [];
  for (const entries of Object.values(mapping)) {
    for (const entry of entries) {
      if (entry.key && entry.key.trim() !== '') {
        keyTextPairs.push({ key: entry.key, text: entry.text });
      }
    }
  }

  // 加载已有词条（如果存在）
  let existingData = {};
  if (fs.existsSync(outputPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    } catch {
      // 如果解析失败，从空对象开始
    }
  }

  // 将 key 按点号分割构建嵌套对象
  for (const { key, text } of keyTextPairs) {
    const parts = key.split('.');
    let current = existingData;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = text;
  }

  // 确保输出目录存在
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(
    outputPath,
    JSON.stringify(existingData, null, 2),
    'utf-8'
  );
  console.log(chalk.green(`\n📝 词条文件已更新：${outputPath}`));
}

module.exports = { replace };
