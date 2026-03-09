# 数据库设计文档

## 概述

CC Look 使用 [sql.js](https://sql.js.org/) 作为本地数据库。sql.js 是 SQLite 的 JavaScript 实现，数据存储在本地文件中。

## 数据库位置

- **macOS**: `~/Library/Application Support/cc-look/cc-look.db`
- **Windows**: `%APPDATA%/cc-look/cc-look.db`

## 表结构

### platforms 表

存储 AI 平台配置信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，UUID |
| name | TEXT | 平台名称 |
| protocol | TEXT | 协议类型：'openai' \| 'anthropic' |
| baseUrl | TEXT | API 基础 URL |
| pathPrefix | TEXT | 路径前缀，如 /openai, /claude |
| enabled | INTEGER | 是否启用：0 \| 1 |
| createdAt | INTEGER | 创建时间戳 |
| updatedAt | INTEGER | 更新时间戳 |

```sql
CREATE TABLE platforms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  baseUrl TEXT NOT NULL,
  pathPrefix TEXT NOT NULL DEFAULT '',
  enabled INTEGER DEFAULT 1,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
)
```

### request_logs 表

存储 API 请求日志。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，UUID |
| platformId | TEXT | 关联的平台 ID |
| baseUrl | TEXT | 请求的基础 URL |
| method | TEXT | HTTP 方法 |
| path | TEXT | 请求路径 |
| requestBody | TEXT | 请求体 (JSON 字符串) |
| requestHeaders | TEXT | 请求头 (JSON 字符串) |
| responseStatus | INTEGER | 响应状态码 |
| responseBody | TEXT | 响应体 |
| responseHeaders | TEXT | 响应头 (JSON 字符串) |
| streamData | TEXT | 汇总的流式数据 (JSON 字符串) |
| duration | INTEGER | 请求耗时 (毫秒) |
| isStream | INTEGER | 是否流式请求：0 \| 1 |
| inputTokens | INTEGER | 输入 token 数 |
| outputTokens | INTEGER | 输出 token 数 |
| cacheReadInputTokens | INTEGER | 缓存读取的 token 数 |
| firstTokenTime | INTEGER | 首个 token 时间 (毫秒) |
| tokensPerSecond | REAL | 输出 token/s |
| error | TEXT | 错误信息 |
| createdAt | INTEGER | 创建时间戳 |

```sql
CREATE TABLE request_logs (
  id TEXT PRIMARY KEY,
  platformId TEXT NOT NULL,
  baseUrl TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  requestBody TEXT,
  requestHeaders TEXT,
  responseStatus INTEGER,
  responseBody TEXT,
  responseHeaders TEXT,
  streamData TEXT,
  duration INTEGER,
  isStream INTEGER DEFAULT 0,
  inputTokens INTEGER,
  outputTokens INTEGER,
  cacheReadInputTokens INTEGER,
  firstTokenTime INTEGER,
  tokensPerSecond REAL,
  error TEXT,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (platformId) REFERENCES platforms(id)
)
```

### settings 表

存储应用设置。

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT | 主键，设置键名 |
| value | TEXT | 设置值 (JSON 字符串) |

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
```

**默认设置值**:

```json
{
  "theme": "system",
  "logRetentionDays": 7,
  "proxyPort": 5005,
  "autoStart": false,
  "minimizeToTray": true,
  "floatingWindow": false
}
```

## 索引

```sql
-- 日志按平台查询优化
CREATE INDEX idx_logs_platformId ON request_logs(platformId)

-- 日志按时间查询优化
CREATE INDEX idx_logs_createdAt ON request_logs(createdAt)
```

## 数据库操作 API

### 初始化

```typescript
import { initDatabase } from './database'

// 应用启动时调用
await initDatabase()
```

### 平台管理

```typescript
import * as db from './database'

// 获取所有平台
const platforms = db.getAllPlatforms()

// 获取单个平台
const platform = db.getPlatformById('platform-id')

// 创建平台
const newPlatform = db.createPlatform({
  name: 'OpenAI',
  protocol: 'openai',
  baseUrl: 'https://api.openai.com',
  pathPrefix: '/openai',
  enabled: true
})

// 更新平台
const updated = db.updatePlatform('platform-id', {
  name: 'New Name'
})

// 删除平台 (同时删除相关日志)
db.deletePlatform('platform-id')
```

### 日志管理

```typescript
// 获取所有日志
const logs = db.getAllLogs(100, 0)

// 获取指定平台日志
const logs = db.getLogsByPlatform('platform-id', 100, 0)

// 创建日志
const log = db.createLog({
  platformId: 'platform-id',
  baseUrl: 'https://api.openai.com',
  method: 'POST',
  path: '/v1/chat/completions',
  requestBody: '{"model":"gpt-4","messages":[]}',
  responseStatus: 200,
  duration: 1500,
  isStream: true,
  inputTokens: 100,
  outputTokens: 500,
  firstTokenTime: 200,
  tokensPerSecond: 35.7
})

// 清除日志
db.clearLogs()  // 清除所有
db.clearLogs('platform-id')  // 清除指定平台

// 导出日志
const json = db.exportLogs('json')
const csv = db.exportLogs('csv', 'platform-id')
```

### 设置管理

```typescript
// 获取设置
const settings = db.getSettings()

// 更新设置
const updated = db.setSettings({
  theme: 'dark',
  proxyPort: 3200
})
```

## 数据迁移

数据库支持自动迁移，当表结构变更时会自动执行：

### 已实现的迁移

1. **platforms 表**
   - 从 `localPort` + `localPath` 迁移到 `pathPrefix`

2. **request_logs 表**
   - 添加 `streamData` 字段
   - 添加 `inputTokens` 字段
   - 添加 `outputTokens` 字段
   - 添加 `firstTokenTime` 字段
   - 添加 `tokensPerSecond` 字段
   - 添加 `cacheReadInputTokens` 字段

3. **settings 表**
   - 从 `basePort` 迁移到 `proxyPort`

### 迁移实现

```typescript
// 检查并添加新字段
const logTableInfo = db.exec("PRAGMA table_info(request_logs)")
const logColumns = logTableInfo[0].values.map(row => row[1] as string)

if (!logColumns.includes('newField')) {
  db.run('ALTER TABLE request_logs ADD COLUMN newField TEXT')
  console.log('[Database] 添加 newField 字段')
}
```

## 数据持久化

数据库采用“内存实时写入 + 文件延迟落盘”的策略：

- 平台、设置、清空日志等低频关键操作会立即落盘
- 请求日志写入会先写入内存数据库，再通过 1 秒防抖批量刷盘
- 应用退出前会强制执行一次 `flushDatabase()`，避免未落盘数据丢失

这样可以减少高频日志场景下反复 `db.export()` 和同步写文件带来的主线程阻塞。

```typescript
function saveDatabase(options?: { immediate?: boolean }): void {
  hasPendingChanges = true

  if (options?.immediate) {
    writeDatabaseToDisk()
    return
  }

  pendingSaveTimer = setTimeout(() => {
    if (hasPendingChanges) {
      writeDatabaseToDisk()
    }
  }, 1000)
}
```

## 注意事项

1. **数据安全**: 数据库文件包含 API Key 等敏感信息，请勿分享
2. **备份**: 建议定期备份 `cc-look.db` 文件
3. **清理**: 日志会持续增长，建议定期清理或设置日志保留天数
