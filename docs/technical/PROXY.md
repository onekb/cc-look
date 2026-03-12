# 代理服务实现文档

## 概述

CC Look 的核心功能是本地代理服务，用于拦截、转发和监控 AI API 请求。代理服务基于 Express.js 实现，支持流式响应 (SSE)。

## 架构设计

### 单端口多路径架构

所有平台共用一个代理端口（默认 5005），通过路径前缀区分不同平台：

```
http://localhost:5005/openai  → OpenAI 平台
http://localhost:5005/claude  → Anthropic 平台
http://localhost:5005/custom  → 自定义平台
```

### ProxyManager 类

```typescript
class ProxyManager {
  private server: http.Server | null = null
  private port: number = 5005
  private platforms: Map<string, Platform> = new Map()
  private isRunning: boolean = false

  // 核心方法
  setPort(port: number): void
  registerPlatform(platform: Platform): void
  unregisterPlatform(platformId: string): void
  start(mainWindow: BrowserWindow | null): Promise<boolean>
  stop(): boolean
  getStatus(platformId: string): PlatformProxy
}
```

## 请求处理流程

### 1. 请求接收

```typescript
app.all('*', async (req: Request, res: Response) => {
  const platform = this.findPlatformByPath(req.path)

  if (!platform) {
    res.status(404).json({
      error: 'Platform not found',
      path: req.path,
      availablePrefixes: [...]
    })
    return
  }

  await this.handleRequest(platform, req, res, mainWindow)
})
```

### 2. 平台匹配

按路径前缀长度降序匹配，确保更长的前缀优先：

```typescript
private findPlatformByPath(path: string): Platform | null {
  const sortedPlatforms = Array.from(this.platforms.values())
    .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)

  for (const platform of sortedPlatforms) {
    if (path.startsWith(platform.pathPrefix)) {
      return platform
    }
  }
  return null
}
```

### 3. 请求转发

```typescript
// 去掉路径前缀，得到实际要转发的路径
const actualPath = req.path.slice(platform.pathPrefix.length) || '/'
const targetUrl = `${platform.baseUrl}${actualPath}`

// 准备请求头
const headers: Record<string, string> = {}
const excludedHeaders = ['host', 'content-length', 'connection', ...]
for (const [key, value] of Object.entries(req.headers)) {
  if (!excludedHeaders.includes(key.toLowerCase())) {
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
}

// 发送请求
const proxyReq = httpModule.request(options, (proxyRes) => {
  // 处理响应...
})
```

## 流式响应处理

### SSE 解析

```typescript
const parseSseEvent = (data: string): void => {
  if (data === '[DONE]') return

  try {
    const parsed = JSON.parse(data)

    // OpenAI 格式
    if (parsed.choices?.[0]?.delta?.content) {
      aggregatedContent += parsed.choices[0].delta.content
    }

    // Anthropic 格式
    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
      aggregatedContent += parsed.delta.text
    }

    // Anthropic thinking
    if (parsed.type === 'content_block_delta' &&
        parsed.delta?.type === 'thinking_delta') {
      aggregatedThinking += parsed.delta.thinking
    }

    // 工具调用...
  } catch {}
}
```

### 响应转发

支持压缩响应的透明转发：

```typescript
// 检测压缩类型
const contentEncoding = proxyRes.headers['content-encoding'] || ''
const isCompressed = ['gzip', 'deflate', 'br'].some(enc =>
  contentEncoding.includes(enc)
)

if (isCompressed && decompressStream) {
  // 解压后处理文本（用于日志）
  decompressStream.on('data', (chunk: Buffer) => {
    processDecompressedData(chunk.toString('utf-8'))
  })

  // 同时转发原始压缩数据
  proxyRes.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
    decompressStream.write(chunk)
    res.write(chunk)
  })
} else {
  // 未压缩响应直接处理
  proxyRes.on('data', (chunk: Buffer) => {
    processDecompressedData(chunk.toString('utf-8'))
    res.write(chunk)
  })
}
```

## Token 统计

### 首 Token 时间

记录从请求开始到收到第一个有内容的 token 的时间：

```typescript
if (firstTokenTime === null && hasContent(parsed)) {
  firstTokenTime = Date.now() - requestStartTime
}
```

### Token/s 计算

从首 token 开始计算生成速度：

```typescript
const tokenGenerationDuration = firstTokenTime !== null
  ? totalDuration - firstTokenTime
  : totalDuration
const tokensPerSecond = outputTokenCount > 0 && tokenGenerationDuration > 0
  ? (outputTokenCount / (tokenGenerationDuration / 1000))
  : null
```

### Usage 提取

从响应中提取官方 token 统计：

```typescript
// OpenAI 格式
if (aggregatedUsage.prompt_tokens) {
  inputTokens = aggregatedUsage.prompt_tokens
}
if (aggregatedUsage.completion_tokens) {
  outputTokenCount = aggregatedUsage.completion_tokens
}

// Anthropic 格式
if (aggregatedUsage.input_tokens) {
  inputTokens = aggregatedUsage.input_tokens
}
if (aggregatedUsage.output_tokens) {
  outputTokenCount = aggregatedUsage.output_tokens
}
if (aggregatedUsage.cache_read_input_tokens) {
  cacheReadInputTokens = aggregatedUsage.cache_read_input_tokens
}
```

## 实时事件推送

代理服务通过 IPC 向渲染进程推送实时事件：

```typescript
// 请求开始
sendStreamEvent(mainWindow, {
  platformId: platform.id,
  requestId,
  type: 'start',
  timestamp: Date.now(),
  content: JSON.stringify({ method, path, body })
})

// 流式数据
sendStreamEvent(mainWindow, {
  platformId: platform.id,
  requestId,
  type: 'delta',
  content: sseData,
  timestamp: Date.now()
})

// 请求结束
sendStreamEvent(mainWindow, {
  platformId: platform.id,
  requestId,
  type: 'end',
  timestamp: Date.now()
})

// 错误
sendStreamEvent(mainWindow, {
  platformId: platform.id,
  requestId,
  type: 'error',
  content: errorMessage,
  timestamp: Date.now()
})
```

## 浮动窗口集成

流式请求时自动向浮动窗口推送内容：

```typescript
// 文本内容
floatingWindowManager.sendContent(requestId, text, 'content')

// 思考内容
floatingWindowManager.sendContent(requestId, thinking, 'thinking')

// 工具调用
floatingWindowManager.sendContent(requestId, JSON.stringify(toolCall), 'tool_use')

// 结束
floatingWindowManager.sendContent(requestId, '', 'end')
floatingWindowManager.scheduleClose(requestId)
```

## 健康检查

代理服务提供健康检查端点：

```typescript
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    platforms: Array.from(this.platforms.values()).map(p => ({
      name: p.name,
      pathPrefix: p.pathPrefix
    }))
  })
})
```

## 错误处理

```typescript
// 请求超时（从设置中读取，0 表示不限时）
const requestTimeout = settings.requestTimeout ?? 120000
if (requestTimeout > 0) {
  proxyReq.setTimeout(requestTimeout, () => {
    console.error('[Proxy] 请求超时')
    proxyReq.destroy(new Error('Request timeout'))
  })
}

// 请求错误
proxyReq.on('error', (err) => {
  console.error('[Proxy] 请求错误:', err.message)
  if (!res.headersSent) {
    res.status(500).json({ error: 'Proxy error', message: err.message })
  }
})

// 响应错误
proxyRes.on('error', (err) => {
  console.error('[Proxy] 响应错误:', err)
})
```

## 配置选项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| 端口 | 5005 | 可在设置中修改 |
| 请求超时 | 120s | 长时间流式请求，0 表示不限时 |
| 服务器超时 | 120s | 服务器连接超时，0 表示不限时 |
| Keep-Alive | 65s | HTTP Keep-Alive，0 表示不限时 |
| 请求体限制 | 10MB | JSON 请求体大小 |

## 使用示例

### 配置客户端

将 AI 客户端的 Base URL 改为本地代理：

```bash
# OpenAI 兼容客户端
OPENAI_API_BASE=http://localhost:5005/openai

# Anthropic SDK
ANTHROPIC_BASE_URL=http://localhost:5005/claude
```

### 发送请求

```bash
curl http://localhost:5005/openai/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```