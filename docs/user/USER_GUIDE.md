# CC Look 用户指南

## 简介

CC Look 是一个本地 AI API 代理软件，帮助开发者更方便地调用、监控和调试各平台的 AI API。

### 解决的问题

在调用 AI API 时，经常会遇到以下问题：
- 界面卡住，不确定是在输出还是真的卡住了
- 无法实时查看 API 调用的状态和内容
- 缺乏统一的日志记录和调试工具
- 多个平台需要分别管理 API Key

CC Look 通过提供本地代理服务解决这些问题。

---

## 安装

### 系统要求

- **macOS**: 10.15 (Catalina) 或更高版本
- **Windows**: Windows 10 或更高版本

### 下载安装

从 [GitHub Releases](https://github.com/onekb/cc-look/releases) 下载对应平台的安装包：

- **macOS**: 下载 `.dmg` 文件
- **Windows**: 下载 `.exe` 安装程序

---

## 快速开始

### 第一步：添加平台

1. 打开 CC Look
2. 点击左侧「平台管理」
3. 点击右上角「添加平台」按钮
4. 填写平台信息：
   - **名称**：自定义名称，如 "OpenAI"、"Claude"
   - **协议**：选择 OpenAI 或 Anthropic
   - **API URL**：API 基础地址
   - **路径前缀**：如 `/openai`、`/claude`
5. 点击保存

### 第二步：启动代理

1. 在平台列表中找到刚添加的平台
2. 点击「启动」按钮
3. 代理服务将在 `http://localhost:5005` 启动

### 第三步：配置应用

将您的应用或工具的 API Base URL 改为本地代理地址：

**OpenAI 兼容客户端**
```
原地址: https://api.openai.com/v1
代理地址: http://localhost:5005/openai/v1
```

**Anthropic SDK**
```
原地址: https://api.anthropic.com
代理地址: http://localhost:5005/claude
```

### 第四步：监控调用

- **实时监控**：在「实时监控」页面查看流式输出
- **调用日志**：在「调用日志」页面查看历史记录

---

## 平台配置详解

### OpenAI 协议

适用于 OpenAI GPT 系列及兼容的 API：

| 配置项 | 示例值 |
|--------|--------|
| 名称 | OpenAI |
| 协议 | OpenAI |
| API URL | https://api.openai.com |
| 路径前缀 | /openai |

**常用 API URL**:
- OpenAI 官方: `https://api.openai.com`
- Azure OpenAI: `https://your-resource.openai.azure.com`
- 中转服务: `https://your-proxy.com`

### Anthropic 协议

适用于 Anthropic Claude 系列 API：

| 配置项 | 示例值 |
|--------|--------|
| 名称 | Claude |
| 协议 | Anthropic |
| API URL | https://api.anthropic.com |
| 路径前缀 | /claude |

---

## 功能说明

### 平台管理

- **添加平台**：配置新的 AI API 平台
- **快速配置**：内置 OpenAI、Claude、DeepSeek、Gemini、智谱、Kimi、阿里云百炼、Z.ai 等模板
- **编辑平台**：修改已有平台配置
- **删除平台**：移除平台及其日志
- **启用/禁用**：临时启用或禁用平台

### 实时监控

实时显示流式 API 调用的输出内容：

- 请求开始时间
- 实时输出文本
- Token 统计
- 输出速度 (tokens/s)
- 首个 Token 延迟

### 调用日志

记录所有 API 调用的详细信息：

- 请求方法和路径
- 请求/响应头
- 请求/响应体
- 流式数据汇总
- Token 使用量
- 耗时统计
- 错误信息
- 会话级聚合视图
- 失败分析面板

**日志操作**:
- 按平台筛选
- 在「会话视图」中按平台、路径和时间窗口聚合同类请求
- 在「失败分析」中查看失败率、失败模式、慢请求和不稳定接口
- 导出为 JSON/CSV
- 清除日志

### 设置中心

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 主题 | 浅色/深色/跟随系统 | 跟随系统 |
| 代理端口 | 本地代理服务端口 | 5005 |
| 日志保留天数 | 自动清理超过天数的日志 | 7 天 |
| 开机自启动 | 系统启动时自动运行 | 关闭 |
| 最小化到托盘 | 关闭窗口时最小化到托盘 | 开启 |
| 浮动窗口 | 启用桌面歌词式输出窗口 | 关闭 |

---

## 浮动窗口功能

启用浮动窗口后，AI 输出内容会在桌面上的独立窗口中实时显示。

### 开启方法

1. 进入「设置」页面
2. 开启「浮动窗口」选项
3. 重启代理服务

### 功能特点

- 透明/无边框设计
- 实时显示 AI 输出
- 支持文本、思考、工具调用等内容类型
- 请求结束后自动关闭

---

## 高级用法

### 使用 curl 测试

```bash
curl http://localhost:5005/openai/v1/chat/completions \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### 配置环境变量

**OpenAI SDK**
```bash
export OPENAI_API_BASE=http://localhost:5005/openai/v1
export OPENAI_API_KEY=sk-xxx
```

**Anthropic SDK**
```bash
export ANTHROPIC_BASE_URL=http://localhost:5005/claude
export ANTHROPIC_API_KEY=sk-xxx
```

### 在代码中使用

**Python OpenAI SDK**
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:5005/openai/v1",
    api_key="your-api-key"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content, end="")
```

---

## 常见问题

### 端口被占用怎么办？

1. 检查是否有其他程序占用端口
2. 在设置中修改代理端口
3. 重启代理服务

### API Key 如何存储？

API Key 存储在本地 SQLite 数据库中，不会上传到任何服务器。

### 如何查看完整的请求/响应？

在「调用日志」页面点击日志条目，可以查看完整的请求和响应详情。

### 支持哪些 AI 平台？

- OpenAI (GPT-3.5, GPT-4, etc.)
- Anthropic (Claude)
- 任何兼容 OpenAI 协议的 API
- 任何兼容 Anthropic 协议的 API

### 日志数据存在哪里？

- macOS: `~/Library/Application Support/cc-look/`
- Windows: `%APPDATA%/cc-look/`

---

## 安全说明

- **本地存储**：所有数据（包括 API Key）仅存储在本地
- **本地通信**：代理通信仅在本地进行，不经过第三方服务器
- **数据导出**：导出的日志可能包含敏感信息，请谨慎分享
