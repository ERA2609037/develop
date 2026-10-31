# 个人生活助手 · Personal Life Assistant

> Xtech Project Lab · 项目一
> 一个本地优先的个人生活中枢：**Todo List / 记账 / 日程 / 日记**

## 技术栈（对应 PPT 第 2–3 页）

| 层 | 选型 |
| --- | --- |
| 前端 | Vue 3（全局构建，免打包步骤） |
| 后端 | Express |
| 数据库 | SQLite（`sql.js`，WASM 版，零原生编译） |
| 桌面套壳 | Electron |

## 开发顺序（对应 PPT 第 4–7 页）

1. **确定技术栈** —— 见上表。
2. **先写后端** —— `server/server.js`：四大功能的 REST CRUD 接口。
3. **设计数据库 Schema** —— 按后端数据模型定义 `todos / expenses / schedules / journals` 四张表。
4. **设计前端** —— `public/`：卡片式首页 + 四大模块页面，支持亮/暗主题切换。
5. **Electron 打包** —— `main.js`：启动后端并加载桌面窗口。

## 目录结构

```
personal-life-assistant/
├─ package.json
├─ main.js                # Electron 主进程（桌面套壳）
├─ server/
│  └─ server.js           # Express + SQLite 后端
├─ public/
│  ├─ index.html          # 页面骨架（Vue 模板）
│  ├─ app.js              # Vue 应用逻辑
│  └─ styles.css          # 设计系统（亮/暗主题）
└─ data/                  # SQLite 数据库文件（运行时生成）
```

## 运行方式

### 方式 A：网页预览（开发调试）
```bash
npm install
npm start
# 浏览器打开 http://localhost:3456
```

### 方式 B：桌面应用（Electron）
```bash
npm install
npm run electron
```

## 功能说明

- **Todo List**：新增/完成/删除、优先级（高/中/低）、截止日期、按状态筛选。
- **记账**：支出/收入、分类、日期、备注，实时统计支出/收入/结余。
- **日程**：标题、地点、开始/结束时间、备注，按时间排序的时间线。
- **日记**：标题、心情、日期、正文，心情表情可视化。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/todos` | 列表 / 新增 |
| PUT/DELETE | `/api/todos/:id` | 更新 / 删除 |
| PATCH | `/api/todos/:id/toggle` | 切换完成状态 |
| GET/POST | `/api/expenses` | 列表 / 新增 |
| PUT/DELETE | `/api/expenses/:id` | 更新 / 删除 |
| GET/POST | `/api/schedules` | 列表 / 新增 |
| PUT/DELETE | `/api/schedules/:id` | 更新 / 删除 |
| GET/POST | `/api/journals` | 列表 / 新增 |
| PUT/DELETE | `/api/journals/:id` | 更新 / 删除 |
| GET | `/api/stats` | 首页汇总统计 |
