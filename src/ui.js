/**
 * ui 命令模块
 * 启动本地可视化配置工作台 (Web UI)
 *
 * 流程：
 * 1. 读取配置，获取 mappingPath
 * 2. 检测 web-ui/node_modules，不存在则自动 npm install
 * 3. 每次构建 web-ui（npm run build）
 * 4. 启动 Express 服务，代理静态资源 + 提供 API
 * 5. 自动打开浏览器
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const chalk = require('chalk');

/**
 * 启动 UI 服务
 * @param {object} config - i18n-auto.config.js 配置对象
 */
async function startUI(config) {
  // ── 1. 解析 mappingPath ──
  const mappingPath = path.resolve(config.mappingPath || 'i18n-mapping.json');
  if (!fs.existsSync(mappingPath)) {
    console.log(chalk.red(`❌ 映射表文件不存在：${mappingPath}`));
    console.log(chalk.yellow('💡 请先运行 node i18n-auto.js extract 生成映射表'));
    process.exit(1);
  }
  console.log(chalk.cyan(`📂 映射表路径：${mappingPath}`));

  // ── 2. web-ui 目录检测与依赖安装 ──
  const webUIDir = path.resolve(__dirname, '..', 'web-ui');
  const nodeModulesDir = path.join(webUIDir, 'node_modules');

  if (!fs.existsSync(webUIDir)) {
    console.log(chalk.red(`❌ web-ui 目录不存在：${webUIDir}`));
    process.exit(1);
  }

  if (!fs.existsSync(nodeModulesDir)) {
    console.log(chalk.yellow('📦 首次运行，正在安装 web-ui 依赖...'));
    execSync('npm install', {
      cwd: webUIDir,
      stdio: 'inherit',
    });
    console.log(chalk.green('✅ web-ui 依赖安装完成'));
  }

  // ── 3. 构建前端产物（每次都执行） ──
  console.log(chalk.cyan('🔨 正在构建 web-ui...'));
  execSync('npm run build', {
    cwd: webUIDir,
    stdio: 'inherit',
  });
  console.log(chalk.green('✅ web-ui 构建完成'));

  // ── 4. 启动 Express 服务 ──
  const express = require('express');
  const app = express();
  const distDir = path.join(webUIDir, 'dist');

  // JSON body 解析
  app.use(express.json({ limit: '50mb' }));

  // API 路由
  app.get('/api/mapping', (_req, res) => {
    try {
      const data = fs.readFileSync(mappingPath, 'utf-8');
      res.json(JSON.parse(data));
    } catch (err) {
      res.status(500).json({ error: `读取映射表失败：${err.message}` });
    }
  });

  app.post('/api/save', (req, res) => {
    try {
      const data = req.body;
      fs.writeFileSync(mappingPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(chalk.green(`\n✅ 映射表已保存至：${mappingPath}`));
      res.json({ success: true, message: '保存成功' });

      // 延迟 1.5 秒后退出主进程
      setTimeout(() => {
        console.log(chalk.cyan('👋 服务即将关闭...'));
        process.exit(0);
      }, 1500);
    } catch (err) {
      res.status(500).json({ error: `保存失败：${err.message}` });
    }
  });

  // 静态资源代理
  app.use(express.static(distDir));

  // SPA fallback：所有未匹配的路由都返回 index.html
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  // ── 5. 监听端口并打开浏览器 ──
  const DEFAULT_PORT = 3088;

  function tryListen(port) {
    const server = app.listen(port, async () => {
      const url = `http://localhost:${port}`;
      console.log(chalk.bold.green(`\n🚀 I18n 可视化工作台已启动：${url}\n`));

      try {
        const open = (await import('open')).default;
        await open(url);
      } catch {
        console.log(chalk.yellow(`💡 请手动打开浏览器访问：${url}`));
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(chalk.yellow(`⚠️  端口 ${port} 被占用，尝试 ${port + 1}...`));
        tryListen(port + 1);
      } else {
        console.error(chalk.red(`❌ 服务启动失败：${err.message}`));
        process.exit(1);
      }
    });
  }

  tryListen(DEFAULT_PORT);
}

module.exports = { startUI };
