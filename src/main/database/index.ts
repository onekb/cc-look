import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { type Platform, type RequestLog, type AppSettings, DEFAULT_SETTINGS } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'

let db: SqlJsDatabase | null = null
let dbPath: string
let settingsCache: AppSettings | null = null

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs()
  dbPath = join(app.getPath('userData'), 'cc-look.db')

  // 尝试加载现有数据库
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // 创建平台表
  db.run(`
    CREATE TABLE IF NOT EXISTS platforms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      baseUrl TEXT NOT NULL,
      pathPrefix TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  // 迁移：检查是否存在旧的列（localPort, localPath）
  const tableInfo = db.exec("PRAGMA table_info(platforms)")
  if (tableInfo.length > 0) {
    const columns = tableInfo[0].values.map(row => row[1] as string)

    // 如果存在 localPort 但不存在 pathPrefix，需要迁移
    if (columns.includes('localPort') && !columns.includes('pathPrefix')) {
      console.log('[Database] 检测到旧表结构，开始迁移...')

      // 创建新表
      db.run(`
        CREATE TABLE platforms_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          protocol TEXT NOT NULL,
          baseUrl TEXT NOT NULL,
          pathPrefix TEXT NOT NULL DEFAULT '',
          enabled INTEGER DEFAULT 1,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        )
      `)

      // 迁移数据：将 localPath 映射到 pathPrefix，如果没有则使用默认值
      const oldPlatforms = db.exec('SELECT * FROM platforms')
      if (oldPlatforms.length > 0) {
        const oldColumns = oldPlatforms[0].columns
        for (const row of oldPlatforms[0].values) {
          const obj: Record<string, unknown> = {}
          oldColumns.forEach((col, i) => {
            obj[col] = row[i]
          })

          // 生成默认的 pathPrefix
          let pathPrefix = obj.localPath as string || ''
          if (!pathPrefix) {
            // 根据协议类型生成默认前缀
            const protocol = obj.protocol as string
            pathPrefix = protocol === 'openai' ? '/openai' : '/claude'
          }

          db.run(
            `INSERT INTO platforms_new (id, name, protocol, baseUrl, pathPrefix, enabled, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              obj.id,
              obj.name,
              obj.protocol,
              obj.baseUrl,
              pathPrefix,
              obj.enabled ? 1 : 0,
              obj.createdAt,
              obj.updatedAt
            ]
          )
        }
      }

      // 删除旧表
      db.run('DROP TABLE platforms')
      // 重命名新表
      db.run('ALTER TABLE platforms_new RENAME TO platforms')

      console.log('[Database] 迁移完成')
    }
  }

  // 创建日志表
  db.run(`
    CREATE TABLE IF NOT EXISTS request_logs (
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
      firstTokenTime INTEGER,
      tokensPerSecond REAL,
      error TEXT,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (platformId) REFERENCES platforms(id)
    )
  `)

  // 迁移日志表：添加新字段
  const logTableInfo = db.exec("PRAGMA table_info(request_logs)")
  if (logTableInfo.length > 0) {
    const logColumns = logTableInfo[0].values.map(row => row[1] as string)

    // 添加 streamData 字段
    if (!logColumns.includes('streamData')) {
      db.run('ALTER TABLE request_logs ADD COLUMN streamData TEXT')
      console.log('[Database] 添加 streamData 字段')
    }
    // 添加 inputTokens 字段
    if (!logColumns.includes('inputTokens')) {
      db.run('ALTER TABLE request_logs ADD COLUMN inputTokens INTEGER')
      console.log('[Database] 添加 inputTokens 字段')
    }
    // 添加 outputTokens 字段
    if (!logColumns.includes('outputTokens')) {
      db.run('ALTER TABLE request_logs ADD COLUMN outputTokens INTEGER')
      console.log('[Database] 添加 outputTokens 字段')
    }
    // 添加 firstTokenTime 字段
    if (!logColumns.includes('firstTokenTime')) {
      db.run('ALTER TABLE request_logs ADD COLUMN firstTokenTime INTEGER')
      console.log('[Database] 添加 firstTokenTime 字段')
    }
    // 添加 tokensPerSecond 字段
    if (!logColumns.includes('tokensPerSecond')) {
      db.run('ALTER TABLE request_logs ADD COLUMN tokensPerSecond REAL')
      console.log('[Database] 添加 tokensPerSecond 字段')
    }
    // 添加 cacheReadInputTokens 字段
    if (!logColumns.includes('cacheReadInputTokens')) {
      db.run('ALTER TABLE request_logs ADD COLUMN cacheReadInputTokens INTEGER')
      console.log('[Database] 添加 cacheReadInputTokens 字段')
    }
  }

  // 创建索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_platformId ON request_logs(platformId)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_createdAt ON request_logs(createdAt)`)

  // 创建设置表
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // 初始化默认设置
  const result = db.exec("SELECT value FROM settings WHERE key = 'appSettings'")
  if (result.length === 0) {
    db.run("INSERT INTO settings (key, value) VALUES (?, ?)", ['appSettings', JSON.stringify(DEFAULT_SETTINGS)])
  } else {
    // 迁移旧设置：将 basePort 改为 proxyPort
    const settingsValue = result[0].values[0][0] as string
    try {
      const oldSettings = JSON.parse(settingsValue)
      if (oldSettings.basePort !== undefined && oldSettings.proxyPort === undefined) {
        oldSettings.proxyPort = oldSettings.basePort
        delete oldSettings.basePort
        db.run("UPDATE settings SET value = ? WHERE key = 'appSettings'", [JSON.stringify(oldSettings)])
        settingsCache = null // 清除缓存
        console.log('[Database] 设置迁移完成：basePort -> proxyPort')
      }
    } catch {
      // ignore
    }
  }

  saveDatabase()
  console.log('[Database] 初始化完成')
}

// 保存数据库到文件
function saveDatabase(): void {
  if (db && dbPath) {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(dbPath, buffer)
  }
}

// ==================== 平台管理 ====================

export function getAllPlatforms(): Platform[] {
  const result = db!.exec('SELECT * FROM platforms ORDER BY createdAt DESC')
  if (result.length === 0) return []

  const columns = result[0].columns
  return result[0].values.map(row => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col] = row[i]
    })
    return {
      ...obj,
      enabled: Boolean(obj.enabled)
    } as Platform
  })
}

export function getPlatformById(id: string): Platform | null {
  const result = db!.exec('SELECT * FROM platforms WHERE id = ?', [id])
  if (result.length === 0 || result[0].values.length === 0) return null

  const columns = result[0].columns
  const row = result[0].values[0]
  const obj: Record<string, unknown> = {}
  columns.forEach((col, i) => {
    obj[col] = row[i]
  })

  return { ...obj, enabled: Boolean(obj.enabled) } as Platform
}

export function createPlatform(data: Omit<Platform, 'id' | 'createdAt' | 'updatedAt'>): Platform {
  const now = Date.now()
  const platform: Platform = {
    ...data,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now
  }

  db!.run(
    `INSERT INTO platforms (id, name, protocol, baseUrl, pathPrefix, enabled, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      platform.id,
      platform.name,
      platform.protocol,
      platform.baseUrl,
      platform.pathPrefix,
      platform.enabled ? 1 : 0,
      platform.createdAt,
      platform.updatedAt
    ]
  )

  saveDatabase()
  console.log(`[Database] 创建平台: ${platform.name}`)
  return platform
}

export function updatePlatform(id: string, updates: Partial<Platform>): Platform | null {
  const platform = getPlatformById(id)
  if (!platform) return null

  const updatedPlatform = {
    ...platform,
    ...updates,
    id: platform.id,
    createdAt: platform.createdAt,
    updatedAt: Date.now()
  }

  db!.run(
    `UPDATE platforms
     SET name = ?, protocol = ?, baseUrl = ?, pathPrefix = ?, enabled = ?, updatedAt = ?
     WHERE id = ?`,
    [
      updatedPlatform.name,
      updatedPlatform.protocol,
      updatedPlatform.baseUrl,
      updatedPlatform.pathPrefix,
      updatedPlatform.enabled ? 1 : 0,
      updatedPlatform.updatedAt,
      id
    ]
  )

  saveDatabase()
  console.log(`[Database] 更新平台: ${updatedPlatform.name}`)
  return updatedPlatform
}

export function deletePlatform(id: string): boolean {
  // 先删除相关日志
  db!.run('DELETE FROM request_logs WHERE platformId = ?', [id])

  // 删除平台
  db!.run('DELETE FROM platforms WHERE id = ?', [id])
  saveDatabase()
  console.log(`[Database] 删除平台: ${id}`)
  return true
}

// ==================== 日志管理 ====================

// 解析日志行
function parseLogRow(columns: string[], row: unknown[]): RequestLog {
  const obj: Record<string, unknown> = {}
  columns.forEach((col, i) => {
    obj[col] = row[i]
  })

  // 解析 JSON 格式的 headers
  let requestHeaders: Record<string, string> | undefined
  let responseHeaders: Record<string, string> | undefined

  try {
    if (obj.requestHeaders && typeof obj.requestHeaders === 'string') {
      requestHeaders = JSON.parse(obj.requestHeaders)
    }
  } catch {
    // ignore parse error
  }

  try {
    if (obj.responseHeaders && typeof obj.responseHeaders === 'string') {
      responseHeaders = JSON.parse(obj.responseHeaders)
    }
  } catch {
    // ignore parse error
  }

  return {
    ...obj,
    requestHeaders,
    responseHeaders,
    isStream: Boolean(obj.isStream)
  } as RequestLog
}

export function getAllLogs(limit = 100, offset = 0): RequestLog[] {
  const result = db!.exec('SELECT * FROM request_logs ORDER BY createdAt DESC LIMIT ? OFFSET ?', [limit, offset])
  if (result.length === 0) return []

  const columns = result[0].columns
  return result[0].values.map(row => parseLogRow(columns, row))
}

export function getLogsByPlatform(platformId: string, limit = 100, offset = 0): RequestLog[] {
  const result = db!.exec(
    'SELECT * FROM request_logs WHERE platformId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
    [platformId, limit, offset]
  )
  if (result.length === 0) return []

  const columns = result[0].columns
  return result[0].values.map(row => parseLogRow(columns, row))
}

export function createLog(log: Omit<RequestLog, 'id' | 'createdAt'>): RequestLog {
  const newLog: RequestLog = {
    ...log,
    id: uuidv4(),
    createdAt: Date.now()
  }

  db!.run(
    `INSERT INTO request_logs (id, platformId, baseUrl, method, path, requestBody, requestHeaders, responseStatus, responseBody, responseHeaders, streamData, duration, isStream, inputTokens, outputTokens, cacheReadInputTokens, firstTokenTime, tokensPerSecond, error, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newLog.id,
      newLog.platformId,
      newLog.baseUrl,
      newLog.method,
      newLog.path,
      newLog.requestBody || null,
      newLog.requestHeaders ? JSON.stringify(newLog.requestHeaders) : null,
      newLog.responseStatus,
      newLog.responseBody || null,
      newLog.responseHeaders ? JSON.stringify(newLog.responseHeaders) : null,
      newLog.streamData || null,
      newLog.duration,
      newLog.isStream ? 1 : 0,
      newLog.inputTokens ?? null,
      newLog.outputTokens ?? null,
      newLog.cacheReadInputTokens ?? null,
      newLog.firstTokenTime ?? null,
      newLog.tokensPerSecond ?? null,
      newLog.error || null,
      newLog.createdAt
    ]
  )

  saveDatabase()
  return newLog
}

export function clearLogs(platformId?: string): boolean {
  if (platformId) {
    db!.run('DELETE FROM request_logs WHERE platformId = ?', [platformId])
  } else {
    db!.run('DELETE FROM request_logs')
  }
  saveDatabase()
  return true
}

export function exportLogs(format: 'json' | 'csv', platformId?: string): string {
  const logs = platformId ? getLogsByPlatform(platformId, 10000) : getAllLogs(10000)

  if (format === 'json') {
    return JSON.stringify(logs, null, 2)
  }

  // CSV 格式
  const headers = ['id', 'platformId', 'method', 'path', 'responseStatus', 'duration', 'isStream', 'error', 'createdAt']
  const rows = logs.map(log =>
    headers.map(h => {
      const value = log[h as keyof RequestLog]
      return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
    }).join(',')
  )

  return [headers.join(','), ...rows].join('\n')
}

// ==================== 设置管理 ====================

export function getSettings(): AppSettings {
  if (settingsCache) {
    return settingsCache
  }

  const result = db!.exec("SELECT value FROM settings WHERE key = 'appSettings'")
  if (result.length > 0 && result[0].values.length > 0) {
    const value = result[0].values[0][0] as string
    settingsCache = JSON.parse(value)
    return settingsCache!
  }

  return DEFAULT_SETTINGS
}

export function setSettings(settings: Partial<AppSettings>): AppSettings {
  const currentSettings = getSettings()
  settingsCache = { ...currentSettings, ...settings }
  db!.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['appSettings', JSON.stringify(settingsCache)])
  saveDatabase()
  return settingsCache
}
