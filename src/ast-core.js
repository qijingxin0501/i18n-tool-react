/**
 * AST 核心模块
 * 负责解析源文件为 AST，遍历并提取包含中文的字符串节点
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// 匹配中文字符的正则
const CHINESE_RE = /[\u4e00-\u9fa5]+/;

/**
 * 解析源代码为 AST
 * @param {string} code - 源代码字符串
 * @param {string} filePath - 文件路径，用于推断语法插件
 * @returns {object} AST 对象
 */
function parseCode(code, filePath) {
  const plugins = [
    'jsx',
    'typescript',
    'decorators-legacy',
    'classProperties',
    'optionalChaining',
    'nullishCoalescingOperator',
  ];

  return parser.parse(code, {
    sourceType: 'module',
    plugins,
    errorRecovery: true, // 遇到语法错误时尽量继续解析
  });
}

/**
 * 检查节点是否在翻译函数调用内部（即已被 intl() 包裹）
 * @param {object} path - Babel 遍历路径
 * @param {string} funcName - 翻译函数名称
 * @returns {boolean}
 */
function isInsideTranslateCall(path, funcName) {
  let current = path.parentPath;
  while (current) {
    if (
      current.isCallExpression() &&
      current.get('callee').isIdentifier({ name: funcName })
    ) {
      return true;
    }
    current = current.parentPath;
  }
  return false;
}

/**
 * 检查节点是否在 console.log/warn/error 调用中
 * @param {object} path - Babel 遍历路径
 * @returns {boolean}
 */
function isInsideConsoleCall(path) {
  let current = path.parentPath;
  while (current) {
    if (current.isCallExpression()) {
      const callee = current.get('callee');
      if (
        callee.isMemberExpression() &&
        callee.get('object').isIdentifier({ name: 'console' })
      ) {
        return true;
      }
    }
    current = current.parentPath;
  }
  return false;
}

/**
 * 检查节点是否为 JSX 属性值
 * @param {object} path - Babel 遍历路径
 * @returns {boolean}
 */
function isJSXAttributeValue(path) {
  return path.parent && path.parent.type === 'JSXAttribute';
}

/**
 * 检查节点是否在 JSX 表达式容器中
 * @param {object} path - Babel 遍历路径
 * @returns {boolean}
 */
function isInJSXExpression(path) {
  let current = path.parentPath;
  while (current) {
    if (current.isJSXExpressionContainer()) {
      return true;
    }
    // 如果遇到了函数边界、JSX 元素或其他语句，就停止向上查找
    // 这样可以避免穿越箭头函数/普通函数后错误地匹配到外层 JSX 表达式
    if (
      current.isJSXElement() ||
      current.isStatement() ||
      current.isArrowFunctionExpression() ||
      current.isFunctionExpression()
    ) {
      break;
    }
    current = current.parentPath;
  }
  return false;
}

/**
 * 检查节点是否在比较表达式中（===, ==, !==, !=）
 * 这类字符串通常是逻辑判断值，不应被翻译
 * @param {object} path - Babel 遍历路径
 * @returns {boolean}
 */
function isInComparisonExpression(path) {
  const parent = path.parent;
  if (!parent) return false;
  if (parent.type === 'BinaryExpression') {
    const comparisonOps = ['===', '==', '!==', '!='];
    return comparisonOps.includes(parent.operator);
  }
  // switch case 中的值也是判断用途
  if (parent.type === 'SwitchCase') {
    return true;
  }
  return false;
}

/**
 * 递归展开 BinaryExpression（+ 运算符）为叶子节点列表
 * @param {object} node - AST 节点
 * @param {string} code - 源代码
 * @returns {Array<{type: string, value: string, node: object}>}
 */
function flattenBinaryConcat(node, code) {
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return [
      ...flattenBinaryConcat(node.left, code),
      ...flattenBinaryConcat(node.right, code),
    ];
  }
  if (node.type === 'StringLiteral') {
    return [{ type: 'string', value: node.value, node }];
  }
  if (node.type === 'TemplateLiteral') {
    // 模板字符串作为表达式处理
    return [{ type: 'expr', value: code.slice(node.start, node.end), node }];
  }
  // 其他类型的节点都作为表达式
  return [{ type: 'expr', value: code.slice(node.start, node.end), node }];
}

/**
 * 规范化模板字符串文本：将换行+连续空白压缩
 * @param {string} text - 原始文本
 * @returns {string} 规范化后的文本
 */
function normalizeTemplateText(text) {
  // 将换行符+连续空白替换为空字符串（保持紧凑）
  return text.replace(/\n\s+/g, '');
}

/**
 * 从源代码中提取包含中文的字符串信息
 * @param {string} code - 源代码
 * @param {string} filePath - 文件路径
 * @param {string} translateFuncName - 翻译函数名称
 * @returns {Array<object>} 提取结果列表
 */
function extractChinese(code, filePath, translateFuncName) {
  const ast = parseCode(code, filePath);
  const results = [];

  // 用来标记已被 JSX 混合处理或字符串拼接处理的节点 start 位置，避免重复提取
  const processedNodeStarts = new Set();

  traverse(ast, {
    // 处理 JSX 元素：合并 children 中的 JSXText + JSXExpressionContainer 混合序列
    JSXElement(path) {
      const children = path.node.children;
      if (!children || children.length <= 1) return;

      // 检查 children 中是否有 JSXText + JSXExpressionContainer 的混合
      const hasJSXText = children.some((c) => c.type === 'JSXText' && CHINESE_RE.test(c.value.trim()));
      const hasJSXExpr = children.some((c) => c.type === 'JSXExpressionContainer');

      if (!hasJSXText || !hasJSXExpr) return;

      // 仅处理「纯文本+表达式」的子元素序列，遇到嵌套 JSXElement 则按段分割
      let segments = []; // 当前段落
      const allSegments = []; // 所有段落
      
      const childPaths = path.get('children');

      for (const childPath of childPaths) {
        const child = childPath.node;
        
        let isSimpleExpr = false;
        if (child.type === 'JSXExpressionContainer') {
          isSimpleExpr = true;
          // 如果表达式内部含有 JSXElement 这种复杂的结构，则认为它不纯
          childPath.traverse({
            JSXElement(p) { isSimpleExpr = false; p.stop(); },
            JSXFragment(p) { isSimpleExpr = false; p.stop(); }
          });
        }

        if (child.type === 'JSXText' || (child.type === 'JSXExpressionContainer' && isSimpleExpr)) {
          segments.push(child);
        } else {
          // 遇到 JSXElement 或复杂的 JSXExpressionContainer 等，切断当前段落
          if (segments.length > 1) {
            allSegments.push([...segments]);
          }
          segments = [];
        }
      }
      if (segments.length > 1) {
        allSegments.push(segments);
      }

      for (const seg of allSegments) {
        // 检查这个段是否同时有中文文本和表达式
        const segHasChinese = seg.some((c) => c.type === 'JSXText' && CHINESE_RE.test(c.value.trim()));
        const segHasExpr = seg.some((c) => c.type === 'JSXExpressionContainer');
        if (!segHasChinese || !segHasExpr) continue;

        // 合并为模板
        let pattern = '';
        let exprIdx = 0;
        const templateExpressions = [];

        for (const child of seg) {
          if (child.type === 'JSXText') {
            // 保留 trim 处理但不过度，只去掉首尾
            pattern += child.value;
            // 标记已处理
            processedNodeStarts.add(child.start);
          } else if (child.type === 'JSXExpressionContainer') {
            const expr = child.expression;
            if (expr.type === 'JSXEmptyExpression') continue;
            pattern += `\${${exprIdx}}`;
            templateExpressions.push(code.slice(expr.start, expr.end));
            exprIdx++;
            processedNodeStarts.add(child.start);
          }
        }

        // trim 整体结果并规范化换行空白
        const trimmedPattern = normalizeTemplateText(pattern.trim());
        if (!CHINESE_RE.test(trimmedPattern)) continue;

        const firstChild = seg[0];
        const lastChild = seg[seg.length - 1];
        const line = firstChild.loc ? firstChild.loc.start.line : 0;

        results.push({
          text: trimmedPattern,
          line,
          start: firstChild.start,
          end: lastChild.end,
          type: 'jsx-mixed',
          templateExpressions,
        });
      }
    },

    // 处理字符串拼接（+ 运算符）
    BinaryExpression(path) {
      if (path.node.operator !== '+') return;

      // 避免处理嵌套的 BinaryExpression（只处理最外层）
      if (path.parent.type === 'BinaryExpression' && path.parent.operator === '+') return;

      // 排除已翻译和 console 调用
      if (isInsideTranslateCall(path, translateFuncName)) return;
      if (isInsideConsoleCall(path)) return;

      const parts = flattenBinaryConcat(path.node, code);

      // 检查是否有任何字符串部分包含中文
      const hasChineseStr = parts.some((p) => p.type === 'string' && CHINESE_RE.test(p.value));
      if (!hasChineseStr) return;

      // 构建模板模式
      let pattern = '';
      let exprIdx = 0;
      const templateExpressions = [];

      for (const part of parts) {
        if (part.type === 'string') {
          pattern += part.value;
          // 标记子字符串节点已处理
          processedNodeStarts.add(part.node.start);
        } else {
          pattern += `\${${exprIdx}}`;
          templateExpressions.push(part.value);
          exprIdx++;
          // 标记表达式节点已处理
          processedNodeStarts.add(part.node.start);
        }
      }

      if (!CHINESE_RE.test(pattern)) return;

      const line = path.node.loc.start.line;

      results.push({
        text: pattern,
        line,
        start: path.node.start,
        end: path.node.end,
        type: 'string-concat',
        templateExpressions,
      });
    },

    // 普通字符串字面量
    StringLiteral(path) {
      // 跳过已被 JSX 混合或字符串拼接处理过的
      if (processedNodeStarts.has(path.node.start)) return;

      const value = path.node.value;
      if (!CHINESE_RE.test(value)) return;
      if (isInsideTranslateCall(path, translateFuncName)) return;
      if (isInsideConsoleCall(path)) return;
      if (isInComparisonExpression(path)) return;

      const line = path.node.loc.start.line;
      const isJSXAttr = isJSXAttributeValue(path);
      const inJSXExpr = isInJSXExpression(path);

      results.push({
        text: value,
        line,
        start: path.node.start,
        end: path.node.end,
        type: isJSXAttr ? 'jsx-attr' : (inJSXExpr ? 'jsx-expr' : 'string'),
      });
    },

    // JSX 文本节点
    JSXText(path) {
      // 跳过已被 JSX 混合处理过的
      if (processedNodeStarts.has(path.node.start)) return;

      const value = path.node.value;
      // JSX 文本通常包含换行和空格，需要 trim 后检测
      const trimmed = value.trim();
      if (!trimmed || !CHINESE_RE.test(trimmed)) return;
      if (isInsideTranslateCall(path, translateFuncName)) return;

      const line = path.node.loc.start.line;

      results.push({
        text: trimmed,
        line,
        start: path.node.start,
        end: path.node.end,
        type: 'jsx-text',
        // 保存原始值用于精确替换
        originalValue: value,
      });
    },

    // 模板字符串
    TemplateLiteral(path) {
      // 拼接模板字符串的内容，检查是否包含中文
      const quasis = path.node.quasis;
      const expressions = path.node.expressions;

      // 构建完整的文本模式（用 ${n} 替换表达式）
      let pattern = '';
      for (let i = 0; i < quasis.length; i++) {
        pattern += quasis[i].value.cooked || quasis[i].value.raw;
        if (i < expressions.length) {
          pattern += `\${${i}}`;
        }
      }

      if (!CHINESE_RE.test(pattern)) return;
      if (isInsideTranslateCall(path, translateFuncName)) return;
      if (isInsideConsoleCall(path)) return;

      const line = path.node.loc.start.line;
      const inJSXExpr = isInJSXExpression(path);

      // 收集原始表达式的源代码
      const templateExpressions = expressions.map((expr) =>
        code.slice(expr.start, expr.end)
      );

      // 问题4修复：规范化换行+空白
      const normalizedPattern = normalizeTemplateText(pattern);

      results.push({
        text: normalizedPattern,
        line,
        start: path.node.start,
        end: path.node.end,
        type: inJSXExpr ? 'jsx-template' : 'template',
        templateExpressions,
      });
    },
  });

  return results;
}

module.exports = {
  parseCode,
  extractChinese,
  CHINESE_RE,
};
