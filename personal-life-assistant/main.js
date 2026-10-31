/**
 * 个人生活助手 —— Electron 主进程（桌面套壳）
 * 按 PPT 第 7 页：用 Electron 打包套壳，成为一个桌面应用。
 *
 * 启动流程：
 *   1. 确定可写的数据库路径（打包后 app.asar 只读，必须写到 userData）
 *   2. 启动 Express + SQLite 后端（复用 server/server.js）
 *   3. 打开桌面窗口，加载 http://localhost:PORT
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');

const BASE_PORT = Number(process.env.PORT) || 3456;
let mainWindow = null;
let httpServer = null;

// 端口被占用时自动向后寻找可用端口（避免与开发服务器冲突）
function pickPort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(pickPort(port + 1)));
    srv.once('listening', () => srv.close(() => resolve(port)));
    srv.listen(port);
  });
}

async function boot() {
  // 数据库写入用户数据目录（可写、持久）
  const dbPath = path.join(app.getPath('userData'), 'life-assistant.db');
  // 首次启动时，若用户目录还没有数据库，则导入随包附带的示例数据
  try {
    if (!fs.existsSync(dbPath)) {
      const seed = path.join(__dirname, 'data', 'life-assistant.db');
      if (fs.existsSync(seed)) fs.copyFileSync(seed, dbPath);
    }
  } catch (e) {
    console.warn('初始化数据库失败:', e.message);
  }
  process.env.DB_PATH = dbPath;

  const PORT = await pickPort(BASE_PORT);
  process.env.PORT = String(PORT);

  // 延迟 require，确保 DB_PATH 在模块加载前已设置
  const { startServer } = require('./server/server');
  const info = await startServer();
  httpServer = info.server;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 840,
    minWidth: 880,
    minHeight: 620,
    title: '个人生活助手',
    backgroundColor: '#0a0e1a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(boot);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) boot();
});

app.on('window-all-closed', () => {
  if (httpServer) httpServer.close();
  app.quit();
});
