/**
 * extract 阶段模块
 * 扫描目标文件，提取中文字符串，生成映射表（路径由配置 mappingPath 决定）
 */
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const chalk = require('chalk');
const readline = require('readline');
const { extractChinese } = require('./ast-core');

/**
 * 交互式确认是否覆盖已有文件
 * @param {string} filePath - 文件路径
 * @returns {Promise<boolean>} 用户是否确认覆盖
 */
function confirmOverwrite(filePath) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      chalk.yellow(`⚠️  文件 ${filePath} 已存在，是否覆盖？(y/N) `),
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      }
    );
  });
}

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
 * 构建反向映射：中文文本 → key 列表
 * @param {object} flatObj - 扁平化后的词条对象
 * @returns {Map<string, string[]>} 反向映射
 */
function buildReverseMap(flatObj) {
  const reverseMap = new Map();
  for (const [key, value] of Object.entries(flatObj)) {
    if (typeof value !== 'string') continue;
    if (!reverseMap.has(value)) {
      reverseMap.set(value, []);
    }
    reverseMap.get(value).push(key);
  }
  return reverseMap;
}

/**
 * 获取匹配的文件列表
 * include 中的每一项可以是目录、单个文件或 glob 模式
 * @param {string[]} include - 包含的目录/文件/模式
 * @param {string[]} exclude - 排除的目录/模式
 * @returns {Promise<string[]>} 文件路径列表
 */
async function getFileList(include, exclude) {
  const extensions = ['js', 'jsx', 'ts', 'tsx'];
  let files = [];

  for (const entry of include) {
    // 判断是否为已存在的文件（直接路径）
    if (fs.existsSync(entry) && fs.statSync(entry).isFile()) {
      files.push(entry);
    } else if (fs.existsSync(entry) && fs.statSync(entry).isDirectory()) {
      // 如果是目录，用 glob 扫描
      const pattern = `${entry}/**/*.{${extensions.join(',')}}`;
      const matched = await glob(pattern, {
        ignore: exclude,
        nodir: true,
      });
      files = files.concat(matched);
    } else {
      // 当作 glob 模式处理
      const matched = await glob(entry, {
        ignore: exclude,
        nodir: true,
      });
      files = files.concat(matched);
    }
  }

  // 去重
  const unique = [...new Set(files)];

  // 按目录树深度优先遍历顺序排序
  // 同一目录的文件排在其子目录文件之前，同级按字母序排列
  unique.sort((a, b) => {
    const partsA = a.split(path.sep);
    const partsB = b.split(path.sep);
    const minLen = Math.min(partsA.length, partsB.length);

    for (let i = 0; i < minLen; i++) {
      const isFileA = i === partsA.length - 1;
      const isFileB = i === partsB.length - 1;

      // 同一层级中，文件排在子目录之前
      if (isFileA && !isFileB) return -1;
      if (!isFileA && isFileB) return 1;

      // 同为目录或同为文件，按字母序比较
      const cmp = partsA[i].localeCompare(partsB[i]);
      if (cmp !== 0) return cmp;
    }

    return partsA.length - partsB.length;
  });

  return unique;
}

/**
 * 执行 extract 阶段
 * @param {object} config - 配置对象
 */
async function extract(config) {
  console.log(chalk.cyan('\n🔍 开始提取阶段...\n'));

  // 1. 获取文件列表
  const files = await getFileList(config.include, config.exclude);
  console.log(chalk.blue(`📂 找到 ${files.length} 个文件待扫描`));

  if (files.length === 0) {
    console.log(chalk.yellow('⚠️  未找到任何匹配的文件'));
    return;
  }

  // 2. 加载已有词条（如果需要自动填充 key）
  let reverseMap = new Map();
  if (config.autoGenerateKey && config.existingLocalePath) {
    const localePath = path.resolve(config.existingLocalePath);
    if (fs.existsSync(localePath)) {
      try {
        const localeData = JSON.parse(
          fs.readFileSync(localePath, 'utf-8')
        );
        const flat = flattenJSON(localeData);
        reverseMap = buildReverseMap(flat);
        console.log(
          chalk.green(`📖 已加载词条文件：${localePath}（${Object.keys(flat).length} 条）`)
        );
      } catch (err) {
        console.log(
          chalk.yellow(`⚠️  无法解析词条文件 ${localePath}：${err.message}`)
        );
      }
    } else {
      console.log(
        chalk.yellow(`⚠️  词条文件不存在：${localePath}，将跳过自动填充 key`)
      );
    }
  }

  // 3. 遍历文件提取中文
  const mapping = {};
  let totalCount = 0;

  for (const filePath of files) {
    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      const items = extractChinese(code, filePath, config.translateFuncName);

      if (items.length === 0) continue;

      // 文件内去重（按 text 去重，保留首次出现）
      const seen = new Set();
      const deduped = [];
      for (const item of items) {
        if (!seen.has(item.text)) {
          seen.add(item.text);
          deduped.push(item);
        }
      }

      // 填充 key
      const entries = deduped.map((item) => {
        const entry = {
          text: item.text,
          key: '',
          line: item.line,
        };

        // 如果有模板表达式信息，也记录到映射表中
        if (item.templateExpressions && item.templateExpressions.length > 0) {
          entry.templateExpressions = item.templateExpressions;
        }

        if (config.autoGenerateKey && reverseMap.has(item.text)) {
          const keys = reverseMap.get(item.text);
          if (config.multipleKeysForSameText && keys.length > 1) {
            // key 默认填第一个匹配，同时输出所有候选 key
            entry.key = keys[0];
            keys.forEach((k, idx) => {
              entry[`key${idx + 1}`] = k;
            });
          } else {
            entry.key = keys[0];
          }
        }

        return entry;
      });

      mapping[filePath] = entries;
      totalCount += entries.length;
      console.log(
        chalk.gray(`  ✓ ${filePath}：提取 ${entries.length} 条中文`)
      );
    } catch (err) {
      console.log(
        chalk.red(`  ✗ ${filePath}：解析失败 - ${err.message}`)
      );
    }
  }

  // 4. 输出映射表文件（路径由 config.mappingPath 配置）
  const outputPath = path.resolve(config.mappingPath || 'i18n-mapping.json');

  // 如果文件已存在，提示用户确认是否覆盖
  if (fs.existsSync(outputPath)) {
    const confirmed = await confirmOverwrite(outputPath);
    if (!confirmed) {
      console.log(chalk.yellow('\n⚠️  已取消，映射表未被覆盖。\n'));
      return;
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(mapping, null, 2), 'utf-8');

  console.log(chalk.cyan('\n📊 提取结果汇总：'));
  console.log(chalk.white(`   扫描文件数：${files.length}`));
  console.log(chalk.white(`   包含中文的文件数：${Object.keys(mapping).length}`));
  console.log(chalk.white(`   提取中文条目总数：${totalCount}`));
  console.log(chalk.green(`\n✅ 映射表已输出到：${outputPath}`));
  console.log(
    chalk.yellow(`💡 请人工检查并编辑 ${path.basename(outputPath)} 中的 key 字段，然后运行 replace 阶段。\n`)
  );
}

module.exports = { extract, flattenJSON, buildReverseMap };
