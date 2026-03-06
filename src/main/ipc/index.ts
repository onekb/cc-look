import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IPC_CHANNELS, type Platform, type RequestLog, type AppSettings, type StreamEvent, type PlatformProxy, DEFAULT_SETTINGS } from '@shared/types'
import * as db from '../database'
import { ProxyManager } from '../proxy'
import { floatingWindowManager } from '../floatingWindow'

const proxyManager = new ProxyManager()
let mainWindow: BrowserWindow | null = null

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

  // ==================== 代理服务 ====================

  ipcMain.handle(IPC_CHANNELS.PROXY_START, async (_, platformId: string): Promise<boolean> => {
    console.log(`[IPC] 启动代理: ${platformId}`)
    const platform = db.getPlatformById(platformId)
    if (!platform) {
      console.error(`[IPC] 平台不存在: ${platformId}`)
      dialog.showErrorBox('启动失败', `平台不存在: ${platformId}`)
      return false
    }

    // 注册平台到代理管理器
    proxyManager.registerPlatform(platform)

    // 启动代理服务器（如果还没启动的话）
    const success = await proxyManager.start(mainWindow)
    if (!success) {
      dialog.showErrorBox('启动失败', `无法启动代理服务，端口 ${proxyManager.getPort()} 可能已被占用`)
    }
    return success
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_STOP, (_, platformId: string): boolean => {
    console.log(`[IPC] 停止代理: ${platformId}`)
    // 注销平台
    proxyManager.unregisterPlatform(platformId)
    // 如果没有平台了，停止服务器
    // 注意：这里我们保持服务器运行，只是取消注册该平台
    return true
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_STATUS, (_, platformId: string): PlatformProxy | null => {
    return proxyManager.getStatus(platformId)
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
