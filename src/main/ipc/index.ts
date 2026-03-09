import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IPC_CHANNELS, type Platform, type RequestLog, type AppSettings, type StreamEvent, type UpdateCheckResult, DEFAULT_SETTINGS } from '@shared/types'
import * as db from '../database'
import { ProxyManager } from '../proxy'
import { floatingWindowManager } from '../floatingWindow'
import * as https from 'https'

const proxyManager = new ProxyManager()
let mainWindow: BrowserWindow | null = null

// 当前版本
const CURRENT_VERSION = '1.0.1'

export function setupIpcHandlers(): void {
  mainWindow = BrowserWindow.getAllWindows()[0]

  // 从设置中获取代理端口
  const settings = db.getSettings()
  proxyManager.setPort(settings.proxyPort || DEFAULT_SETTINGS.proxyPort)

  // ==================== 平台管理 ====================

  ipcMain.handle(IPC_CHANNELS.PLATFORM_GET_ALL, (): Platform[] => {
    console.log('[IPC] 获取所有平台')
    return db.getAllPlatforms()
  })

  ipcMain.handle(IPC_CHANNELS.PLATFORM_GET, (_, id: string): Platform | null => {
    console.log(`[IPC] 获取平台: ${id}`)
    return db.getPlatformById(id)
  })

  ipcMain.handle(IPC_CHANNELS.PLATFORM_CREATE, (_, data: Omit<Platform, 'id' | 'createdAt' | 'updatedAt'>): Platform => {
    console.log(`[IPC] 创建平台: ${data.name}`)
    const platform = db.createPlatform(data)
    // 注册平台到代理管理器
    proxyManager.registerPlatform(platform)
    return platform
  })

  ipcMain.handle(IPC_CHANNELS.PLATFORM_UPDATE, async (_, id: string, updates: Partial<Platform>): Promise<Platform | null> => {
    console.log(`[IPC] 更新平台: ${id}`)
    const platform = db.updatePlatform(id, updates)

    // 更新代理管理器中的平台配置
    if (platform) {
      proxyManager.registerPlatform(platform)
    }

    return platform
  })

  ipcMain.handle(IPC_CHANNELS.PLATFORM_DELETE, (_, id: string): boolean => {
    console.log(`[IPC] 删除平台: ${id}`)
    proxyManager.unregisterPlatform(id)
    return db.deletePlatform(id)
  })

  ipcMain.handle(IPC_CHANNELS.PLATFORM_TOGGLE, (_, id: string): Platform | null => {
    console.log(`[IPC] 切换平台状态: ${id}`)
    const platform = db.getPlatformById(id)
    if (!platform) return null
    return db.updatePlatform(id, { enabled: !platform.enabled })
  })

  // ==================== 代理服务（统一管理） ====================

  // 启动代理服务（注册所有平台）
  ipcMain.handle(IPC_CHANNELS.PROXY_START, async (): Promise<boolean> => {
    console.log('[IPC] 启动代理服务')

    // 注册所有启用的平台
    const platforms = db.getAllPlatforms().filter(p => p.enabled)
    for (const platform of platforms) {
      proxyManager.registerPlatform(platform)
    }

    // 启动代理服务器
    const success = await proxyManager.start(mainWindow)
    if (!success) {
      dialog.showErrorBox('启动失败', `无法启动代理服务，端口 ${proxyManager.getPort()} 可能已被占用`)
    }
    return success
  })

  // 停止代理服务
  ipcMain.handle(IPC_CHANNELS.PROXY_STOP, (): boolean => {
    console.log('[IPC] 停止代理服务')
    return proxyManager.stop()
  })

  // 获取代理服务状态
  ipcMain.handle(IPC_CHANNELS.PROXY_STATUS, (): { isRunning: boolean; port: number } => {
    return {
      isRunning: proxyManager.getIsRunning(),
      port: proxyManager.getPort()
    }
  })

  // ==================== 日志管理 ====================

  ipcMain.handle(IPC_CHANNELS.LOG_GET_ALL, (_, limit?: number, offset?: number): RequestLog[] => {
    console.log(`[IPC] 获取所有日志: limit=${limit}, offset=${offset}`)
    return db.getAllLogs(limit, offset)
  })

  ipcMain.handle(IPC_CHANNELS.LOG_GET_BY_PLATFORM, (_, platformId: string, limit?: number, offset?: number): RequestLog[] => {
    console.log(`[IPC] 获取平台日志: ${platformId}`)
    return db.getLogsByPlatform(platformId, limit, offset)
  })

  ipcMain.handle(IPC_CHANNELS.LOG_CLEAR, (_, platformId?: string): boolean => {
    console.log(`[IPC] 清空日志: ${platformId || 'all'}`)
    return db.clearLogs(platformId)
  })

  ipcMain.handle(IPC_CHANNELS.LOG_EXPORT, (_, format: 'json' | 'csv', platformId?: string): string => {
    console.log(`[IPC] 导出日志: format=${format}, platformId=${platformId}`)
    return db.exportLogs(format, platformId)
  })

  // ==================== 设置管理 ====================

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (): AppSettings => {
    return db.getSettings()
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_, settings: Partial<AppSettings>): AppSettings => {
    console.log(`[IPC] 更新设置`)
    const newSettings = db.setSettings(settings)

    // 如果端口改变了，更新代理管理器的端口
    if (settings.proxyPort !== undefined) {
      proxyManager.setPort(settings.proxyPort)
      // 如果代理正在运行，需要重启
      proxyManager.stop()
    }

    return newSettings
  })

  // ==================== 调试工具 ====================

  ipcMain.handle('debug:testFloatingWindow', async (): Promise<void> => {
    console.log('[IPC] 测试浮动窗口')

    const testRequestId = `test-${Date.now()}`
    const testContent = '这是一段测试内容，用于验证浮动窗口的显示效果。每一句话都会追加到窗口中，就像真实的流式输出一样。'

    // 创建窗口
    floatingWindowManager.createWindow(testRequestId)
    floatingWindowManager.sendContent(testRequestId, '', 'start')

    // 模拟流式输出
    let charIndex = 0
    const totalChars = 300
    const interval = setInterval(() => {
      if (charIndex >= totalChars) {
        clearInterval(interval)
        floatingWindowManager.sendContent(testRequestId, '', 'end')
        floatingWindowManager.scheduleClose(testRequestId, 3000)
        return
      }

      // 每次输出一个字符
      const char = testContent[charIndex % testContent.length]
      floatingWindowManager.sendContent(testRequestId, char, 'content')
      charIndex++
    }, 100) // 每100ms输出一个字符
  })

  // ==================== 更新检查 ====================

  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async (): Promise<UpdateCheckResult> => {
    console.log('[IPC] 检查更新')

    return new Promise((resolve) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/onekb/cc-look/releases/latest',
        method: 'GET',
        headers: {
          'User-Agent': 'CC-Look-App',
          'Accept': 'application/vnd.github.v3+json'
        }
      }

      const req = https.request(options, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          try {
            const release = JSON.parse(data)
            const latestVersion = release.tag_name.replace(/^v/, '') // 移除 v 前缀

            // 比较版本号
            const hasUpdate = compareVersions(latestVersion, CURRENT_VERSION) > 0

            resolve({
              hasUpdate,
              currentVersion: CURRENT_VERSION,
              latestVersion,
              releaseUrl: release.html_url,
              releaseNotes: release.body?.slice(0, 500) // 截取前500字符
            })
          } catch (error) {
            console.error('[IPC] 解析更新信息失败:', error)
            resolve({
              hasUpdate: false,
              currentVersion: CURRENT_VERSION,
              latestVersion: CURRENT_VERSION,
              releaseUrl: 'https://github.com/onekb/cc-look/releases'
            })
          }
        })
      })

      req.on('error', (error) => {
        console.error('[IPC] 检查更新失败:', error)
        resolve({
          hasUpdate: false,
          currentVersion: CURRENT_VERSION,
          latestVersion: CURRENT_VERSION,
          releaseUrl: 'https://github.com/onekb/cc-look/releases'
        })
      })

      req.setTimeout(10000, () => {
        req.destroy()
        resolve({
          hasUpdate: false,
          currentVersion: CURRENT_VERSION,
          latestVersion: CURRENT_VERSION,
          releaseUrl: 'https://github.com/onekb/cc-look/releases'
        })
      })

      req.end()
    })
  })

  // ==================== 自动启动代理服务 ====================

  // 注册所有启用的平台并启动代理服务
  const platforms = db.getAllPlatforms().filter(p => p.enabled)
  for (const platform of platforms) {
    proxyManager.registerPlatform(platform)
  }

  if (platforms.length > 0) {
    console.log('[IPC] 自动启动代理服务...')
    proxyManager.start(mainWindow).then((success) => {
      if (success) {
        console.log('[IPC] 代理服务自动启动成功')
      } else {
        console.error('[IPC] 代理服务自动启动失败')
      }
    })
  }
}

// 版本号比较函数
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0
    const numB = partsB[i] || 0
    if (numA > numB) return 1
    if (numA < numB) return -1
  }
  return 0
}

// 导出流事件发送函数
export function sendStreamEvent(window: BrowserWindow | null, event: StreamEvent): void {
  console.log(`[IPC] sendStreamEvent called: type=${event.type}, requestId=${event.requestId}`)
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.PROXY_STREAM, event)
    console.log(`[IPC] Stream event sent to renderer`)
  } else {
    console.log(`[IPC] Window not available, cannot send stream event`)
  }
}
