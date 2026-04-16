/**
 * sync 阶段模块
 * 扫描代码中已完成国际化替换的 intl() 调用，
 * 找出 key 在 zh_CN.json 中缺失的条目，回填到 JSON 文件中
 */
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const chalk = require('chalk');
const readline = require('readline');
const { parseCode, CHINESE_RE } = require('./ast-core');
const traverse = require('@babel/traverse').default;

/**
 * 递归扁平化嵌套 JSON 对象
 * 例如 { common: { confirm: "确认" } } => { "common.confirm": "确认" }
 * @param {object} obj - 嵌套对象
 * @param {string} prefix - 当前 key 前缀
 * @returns {object} 扁平化后的键值对
 */
function flattenJSON(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenJSON(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

/**
 * 将扁平 key 写入嵌套 JSON 对象
 * @param {object} obj - 目标嵌套对象
 * @param {string} key - 点号分隔的 key
 * @param {string} value - 值
 */
function setNestedValue(obj, key, value) {
  const parts = key.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * 获取匹配的文件列表（复用 extract.js 的逻辑）
 * @param {string[]} include - 包含的目录/文件/模式
 * @param {string[]} exclude - 排除的目录/模式
 * @returns {Promise<string[]>} 文件路径列表
 */
async function getFileList(include, exclude) {
  const extensions = ['js', 'jsx', 'ts', 'tsx'];
  let files = [];

  for (const entry of include) {
    if (fs.existsSync(entry) && fs.statSync(entry).isFile()) {
      files.push(entry);
    } else if (fs.existsSync(entry) && fs.statSync(entry).isDirectory()) {
      const pattern = `${entry}/**/*.{${extensions.join(',')}}`;
      const matched = await glob(pattern, {
        ignore: exclude,
        nodir: true,
      });
      files = files.concat(matched);
    } else {
      const matched = await glob(entry, {
        ignore: exclude,
        nodir: true,
      });
      files = files.concat(matched);
    }
  }

  return [...new Set(files)];
}

/**
 * 从单个文件的 AST 中提取所有 intl() 调用的 key 和 defaultText
 * @param {string} code - 源代码
 * @param {string} filePath - 文件路径
 * @param {string} funcName - 翻译函数名
 * @returns {Array<{ key: string, defaultText: string, line: number }>}
 */
function extractIntlCalls(code, filePath, funcName) {
  const ast = parseCode(code, filePath);
  const results = [];

  traverse(ast, {
    CallExpression(nodePath) {
      const callee = nodePath.get('callee');

      // 匹配 intl(...) 或配置的翻译函数名
      if (!callee.isIdentifier({ name: funcName })) return;

      const args = nodePath.node.arguments;
      if (args.length === 0) return;

      const firstArg = args[0];

      // 匹配 intl({ key: '...', defaultText: '...' }) 的对象参数形式
      if (firstArg.type !== 'ObjectExpression') return;

      let key = '';
      let defaultText = '';

      for (const prop of firstArg.properties) {
        if (prop.type !== 'ObjectProperty') continue;

        const propName =
          prop.key.type === 'Identifier'
            ? prop.key.name
            : prop.key.type === 'StringLiteral'
              ? prop.key.value
              : '';

        if (propName === 'key' && prop.value.type === 'StringLiteral') {
          key = prop.value.value;
        }
        if (propName === 'defaultText' && prop.value.type === 'StringLiteral') {
          defaultText = prop.value.value;
        }
      }

      if (key && defaultText) {
        results.push({
          key,
          defaultText,
          line: nodePath.node.loc.start.line,
        });
      }
    },
  });

  return results;
}

/**
 * 交互式确认
 * @param {string} question - 提示信息
 * @returns {Promise<boolean>}
 */
function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

/**
 * 执行 sync 阶段
 * @param {object} config - 配置对象
 */
async function sync(config) {
  console.log(chalk.cyan('\n🔍 开始同步检查...\n'));

  // 1. 检查词条文件路径配置
  const localePath = path.resolve(config.existingLocalePath || config.outputLocalePath);
  if (!localePath) {
    console.log(chalk.red('❌ 未配置词条文件路径（existingLocalePath 或 outputLocalePath）'));
    process.exit(1);
  }

  if (!fs.existsSync(localePath)) {
    console.log(chalk.red(`❌ 词条文件不存在：${localePath}`));
    process.exit(1);
  }

  // 2. 加载并扁平化 zh_CN.json
  let localeData;
  try {
    localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
  } catch (err) {
    console.log(chalk.red(`❌ 无法解析词条文件：${err.message}`));
    process.exit(1);
  }

  const flatLocale = flattenJSON(localeData);
  console.log(chalk.green(`📖 已加载词条文件：${localePath}（${Object.keys(flatLocale).length} 条）\n`));

  // 3. 扫描代码文件
  const files = await getFileList(config.include, config.exclude);
  console.log(chalk.blue(`📂 找到 ${files.length} 个文件待扫描\n`));

  if (files.length === 0) {
    console.log(chalk.yellow('⚠️  未找到任何匹配的文件'));
    return;
  }

  // 4. 提取所有 intl() 调用
  const allCalls = []; // { key, defaultText, line, file }
  let scannedCount = 0;

  for (const filePath of files) {
    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      const calls = extractIntlCalls(code, filePath, config.translateFuncName);
      if (calls.length > 0) {
        scannedCount++;
        for (const call of calls) {
          allCalls.push({ ...call, file: filePath });
        }
      }
    } catch (err) {
      console.log(chalk.red(`  ✗ ${filePath}：解析失败 - ${err.message}`));
    }
  }

  console.log(chalk.blue(`🔎 在 ${scannedCount} 个文件中找到 ${allCalls.length} 处 ${config.translateFuncName}() 调用\n`));

  // 5. 按 key 去重（同一个 key 可能在多处使用，取第一次出现的 defaultText）
  const uniqueKeys = new Map(); // key -> { defaultText, occurrences: [{ file, line }] }
  for (const call of allCalls) {
    if (!uniqueKeys.has(call.key)) {
      uniqueKeys.set(call.key, {
        defaultText: call.defaultText,
        occurrences: [],
      });
    }
    uniqueKeys.get(call.key).occurrences.push({ file: call.file, line: call.line });
  }

  // 6. 找出缺失的 key
  const missingEntries = []; // { key, defaultText, occurrences }
  for (const [key, info] of uniqueKeys) {
    if (!(key in flatLocale)) {
      missingEntries.push({ key, ...info });
    }
  }

  // 7. 输出结果
  if (missingEntries.length === 0) {
    console.log(chalk.green('✅ 所有 key 均已存在于词条文件中，无需同步。\n'));
    return;
  }

  console.log(chalk.yellow.bold(`⚠️  发现 ${missingEntries.length} 个 key 在词条文件中缺失：\n`));

  // 按 key 名排序后展示
  missingEntries.sort((a, b) => a.key.localeCompare(b.key));

  for (const entry of missingEntries) {
    console.log(chalk.white(`  ${chalk.cyan(entry.key)} → ${chalk.gray(`"${entry.defaultText}"`)}`));
    // 展示部分出现位置（最多显示 3 处）
    const showCount = Math.min(entry.occurrences.length, 3);
    for (let i = 0; i < showCount; i++) {
      const occ = entry.occurrences[i];
      console.log(chalk.gray(`    └─ ${occ.file}:${occ.line}`));
    }
    if (entry.occurrences.length > 3) {
      console.log(chalk.gray(`    └─ ... 还有 ${entry.occurrences.length - 3} 处`));
    }
  }

  // 8. 安全确认
  console.log('');
  console.log(chalk.yellow.bold('⚠️  注意：此操作将修改词条文件（JSON），请确保：'));
  console.log(chalk.yellow('   1. 词条文件已保存（关闭编辑器中的未保存更改）'));
  console.log(chalk.yellow('   2. 词条文件已加入 Git 版本管理（已 commit 或 stash），以便在需要时可以回退'));
  console.log('');

  const confirmed = await confirm(
    chalk.white(`是否将 ${missingEntries.length} 个缺失 key 写入 ${path.basename(localePath)}？(y/N) `)
  );

  if (!confirmed) {
    console.log(chalk.yellow('\n⚠️  已取消同步操作。\n'));
    return;
  }

  // 9. 重新读取文件（避免用户在确认前修改了文件）
  try {
    localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
  } catch (err) {
    console.log(chalk.red(`❌ 重新读取词条文件失败：${err.message}`));
    process.exit(1);
  }

  // 10. 写入缺失的 key
  let addedCount = 0;
  for (const entry of missingEntries) {
    setNestedValue(localeData, entry.key, entry.defaultText);
    addedCount++;
  }

  // 11. 写回文件
  try {
    fs.writeFileSync(localePath, JSON.stringify(localeData, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.log(chalk.red(`❌ 写入词条文件失败：${err.message}`));
    process.exit(1);
  }

  console.log(chalk.cyan('\n📊 同步结果汇总：'));
  console.log(chalk.white(`   扫描文件数：${files.length}`));
  console.log(chalk.white(`   包含 ${config.translateFuncName}() 的文件数：${scannedCount}`));
  console.log(chalk.white(`   ${config.translateFuncName}() 调用总数：${allCalls.length}`));
  console.log(chalk.white(`   唯一 key 数：${uniqueKeys.size}`));
  console.log(chalk.green(`   新增 key 数：${addedCount}`));
  console.log(chalk.green(`\n✅ 词条文件已更新：${localePath}\n`));
}

module.exports = { sync };
