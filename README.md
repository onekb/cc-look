# CC Look

<div align="center">
  <img src="resources/icon.png" alt="CC Look Logo" width="128" height="128">

  **本地 AI API 代理软件**

  支持多平台 AI API 监控与调试的跨平台桌面应用

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue.svg)](https://github.com)

</div>

---

## 📸 应用截图

<div align="center">

| 首页 | 调用日志 | 请求详情 |
|:---:|:---:|:---:|
| <img src="resources/首页.jpg" width="250"> | <img src="resources/调用日志.jpg" width="250"> | <img src="resources/请求详情.jpg" width="250"> |

</div>

---

## 🎬 演示视频

https://github.com/user-attachments/assets/bc60b592-d20f-49b9-ae40-f23f3256eb36


> 如果视频无法播放，请直接查看 [resources/cc-look.mp4](resources/cc-look.mp4)

---

## 📖 简介

CC Look 是一个本地 AI API 代理软件，帮助开发者更方便地调用、监控和调试各平台的 AI API。

### 解决的问题

在调用 AI API 时，经常会遇到以下问题：
- 🤔 界面卡住，不确定是在输出还是真的卡住了
- 🔍 无法实时查看 API 调用的状态和内容
- 📝 缺乏统一的日志记录和调试工具
- 🔑 多个平台需要分别管理 API Key

CC Look 通过提供本地代理服务，让您可以：
- ✅ 实时监控 AI API 的输出内容
- ✅ 查看完整的请求/响应日志
- ✅ 统一管理多个 AI 平台配置
- ✅ 支持 OpenAI 和 Anthropic Claude 协议

---

## ✨ 功能特性

### 🖥️ 平台管理
- 支持添加多个 AI 平台配置
- 支持 OpenAI 协议和 Anthropic Claude 协议
- 内置 OpenAI、Claude、DeepSeek、Gemini、智谱、Kimi、阿里云百炼、Z.ai 等快速配置模板
- 自定义 API Base URL（支持代理/中转服务）
- 统一代理端口，通过路径前缀区分不同平台

### 📡 本地代理服务
- 一键启动/停止代理
- 自动处理 API 认证头
- 支持 SSE 流式响应
- 请求/响应自动记录
- 日志写入采用延迟批量落盘，减少高频请求下的卡顿

### 📊 实时监控
- 实时显示流式响应内容
- 连接状态指示器
- 输出速度监控（Token/s）
- 首 Token 时间统计

### 📝 日志系统
- 完整的请求/响应记录
- 支持按平台筛选
- 支持会话级视图，按平台、方法、路径和时间窗口聚合同类请求
- 内置失败分析面板，查看失败率、失败模式、慢请求和不稳定接口
- 请求体、响应体、流式汇总支持全屏预览
- 日志导出（JSON/CSV）
- 调用统计

### ⚙️ 设置中心
- 主题切换（浅色/深色/跟随系统）
- 日志保留策略与存储大小查看
- 清空日志功能
- 代理端口配置
- 开机自启动
- 动态浮动窗口

---

## 🚀 快速开始

### 系统要求

- macOS 10.15+ 或 Windows 10+
- Node.js 18+

### 安装

#### 方式一：下载安装包（推荐）

从 [Releases](https://github.com/onekb/cc-look/releases) 页面下载对应平台的安装包。

#### 方式二：从源码构建

```bash
# 克隆仓库
git clone https://github.com/onekb/cc-look.git
cd cc-look

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建生产版本
npm run build:mac   # macOS
npm run build:win   # Windows
```

### 使用方法

1. **添加平台**
   - 点击「添加平台」按钮，或直接使用「快速配置」模板
   - 选择主流平台模板后，会自动填入平台名称、协议类型、API URL 和路径前缀
   - 也可以手动填写和调整配置
   - 例如：智谱 AI，路径前缀 `/bigmodel`

2. **启动代理**
   - 点击「启动服务」按钮
   - 代理服务将在 `http://localhost:5005` 启动

3. **配置应用**

   **OpenClaw 用户：**
   - 修改 `~/.openclaw/agents/main/agent/models.json` 中的 `baseUrl` 配置
   - 将 baseUrl 改为 `http://localhost:5005/{路径前缀}`

   **Claude Code 用户：**
   - 配合 [CC Switch](https://github.com/farion1231/cc-switch) 使用，30秒完成配置！
   - 操作视频：

https://github.com/user-attachments/assets/a2238663-77bc-4b5b-8263-1a91d7610378

  **其他工具 用户：**
  - 酌情修改 `baseUrl`


4. **监控调用**
   - 在「调用日志」页面查看实时请求、历史记录、会话视图和失败分析
   - 支持复制 curl 命令、请求详情全屏预览、导出日志等功能

---

## 📁 项目结构

```
cc-look/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.ts         # 主进程入口
│   │   ├── ipc/             # IPC 通信处理
│   │   │   └── index.ts
│   │   ├── database/        # 数据存储层
│   │   │   └── index.ts
│   │   └── proxy/           # 代理服务
│   │       └── index.ts
│   │
│   ├── renderer/            # React 前端
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/           # 页面组件
│   │   │   ├── Platforms.tsx
│   │   │   ├── Logs.tsx
│   │   │   └── Settings.tsx
│   │   ├── components/      # UI 组件
│   │   │   └── Sidebar.tsx
│   │   ├── stores/          # 状态管理
│   │   │   └── platform.ts
│   │   └── styles/          # 样式文件
│   │       └── index.css
│   │
│   ├── preload/             # 预加载脚本
│   │   └── index.ts
│   │
│   └── shared/              # 共享代码
│       └── types.ts         # 类型定义
│
├── resources/               # 资源文件
│   ├── icon.png            # 应用图标
│   ├── logo.svg            # Logo
│   └── *.jpg               # 截图
│
├── package.json
├── electron.vite.config.ts
├── tailwind.config.cjs
└── tsconfig.json
```

---

## 🛠️ 技术栈

| 技术 | 用途 |
|------|------|
| [Electron](https://www.electronjs.org/) | 跨平台桌面应用框架 |
| [React](https://react.dev/) | 前端 UI 框架 |
| [TypeScript](https://www.typescriptlang.org/) | 类型安全 |
| [Vite](https://vitejs.dev/) | 构建工具 |
| [TailwindCSS](https://tailwindcss.com/) | 样式方案 |
| [Zustand](https://github.com/pmndrs/zustand) | 状态管理 |
| [Express](https://expressjs.com/) | 本地代理服务器 |
| [sql.js](https://sql.js.org/) | 本地数据库 |

---

## 📋 开发指南

### 常用命令

```bash
# 开发模式
npm run dev

# 类型检查
npm run typecheck

# 构建
npm run build

# 打包 macOS
npm run build:mac

# 打包 Windows
npm run build:win
```

### 添加新的 AI 协议支持

1. 在 `src/shared/types.ts` 中添加新的协议类型
2. 在 `src/main/proxy/index.ts` 中实现代理逻辑
3. 更新前端表单以支持新协议选项

### 调试技巧

- 主进程日志：在终端查看
- 渲染进程日志：打开 DevTools (开发模式下自动打开)
- 数据库文件：`~/Library/Application Support/cc-look/cc-look.db` (macOS)

---

## 🔒 安全说明

- **API Key 存储**：API Key 存储在本地 SQLite 数据库中，不会上传到任何服务器
- **本地通信**：所有代理通信都在本地进行，不经过第三方服务器
- **日志数据**：请求/响应日志仅存储在本地，可随时清除

---

## ❓ 常见问题

### macOS 提示"CC Look.app"已损坏，无法打开

这是 macOS 的安全机制导致的，执行以下命令即可解决：

```bash
sudo xattr -dr com.apple.quarantine /Applications/CC\ Look.app
```

---

## 🤝 贡献指南

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- 所有开源项目的贡献者
- [Breadbot86](https://github.com/breadbot86) 这是我家龙虾，它会帮我宣传。同时它自己维护的项目会在它的账号里更新，欢迎拜访。

---

<div align="center">

### ⭐ 如果这个项目对你有帮助，请给一个 Star 支持一下！⭐

[![Star History Chart](https://api.star-history.com/svg?repos=onekb/cc-look&type=Date)](https://www.star-history.com/#onekb/cc-look&Date)


**[⬆ 返回顶部](#cc-look)**

Made with ❤️ by CC Look Team

</div>
