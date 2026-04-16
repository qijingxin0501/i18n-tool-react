#!/usr/bin/env node
/**
 * 国际化自动化脚本 - 主入口
 * 用法：
 *   node i18n-auto.js extract  - 提取中文，生成映射表
 *   node i18n-auto.js replace  - 读取映射表，执行替换
 *   node i18n-auto.js sync     - 同步缺失的 key 到词条文件
 *   node i18n-auto.js ui       - 启动本地可视化配置工作台
 */
const path = require('path');
const chalk = require('chalk');

// 加载配置
let config;
try {
  config = require(path.resolve('i18n-auto.config.js'));
} catch (err) {
  console.log(
    chalk.red('❌ 无法加载配置文件 i18n-auto.config.js')
  );
  console.log(
    chalk.yellow('💡 请确保项目根目录下存在 i18n-auto.config.js 配置文件')
  );
  process.exit(1);
}

// 解析命令
const command = process.argv[2];

async function main() {
  console.log(chalk.bold.cyan('\n═══════════════════════════════════════'));
  console.log(chalk.bold.cyan('   🌐 国际化自动化脚本 (i18n-auto)'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════\n'));

  switch (command) {
    case 'extract': {
      const { extract } = require('./src/extract');
      await extract(config);
      break;
    }
    case 'replace': {
      const { replace } = require('./src/replace');
      const { generateReport } = require('./src/report');
      const result = await replace(config);
      generateReport(result, config.reportPath);
      break;
    }
    case 'sync': {
      const { sync } = require('./src/sync');
      await sync(config);
      break;
    }
    case 'ui': {
      const { startUI } = require('./src/ui');
      await startUI(config);
      break;
    }
    default: {
      console.log(chalk.white('用法：'));
      console.log(chalk.white('  node i18n-auto.js extract  - 提取中文，生成映射表'));
      console.log(chalk.white('  node i18n-auto.js replace  - 读取映射表，执行替换'));
      console.log(chalk.white('  node i18n-auto.js sync     - 同步缺失的 key 到词条文件'));
      console.log(chalk.white('  node i18n-auto.js ui       - 启动本地可视化配置工作台'));
      console.log('');
      if (command) {
        console.log(chalk.red(`❌ 未知命令：${command}`));
      }
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(chalk.red(`\n❌ 运行出错：${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
