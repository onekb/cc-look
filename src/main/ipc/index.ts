import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IPC_CHANNELS, type Platform, type RequestLog, type AppSettings, type StreamEvent, type UpdateCheckResult, DEFAULT_SETTINGS } from '@shared/types'
import { APP_VERSION } from '@shared/constants'
import * as db from '../database'
import { ProxyManager } from '../proxy'
import { floatingWindowManager } from '../floatingWindow'
import * as https from 'https'
import { exec } from 'child_process'
import { promisify } from 'util'
import { platform } from 'os'
import { getCaCertPem } from '../proxy/cert'

const execAsync = promisify(exec)

async function getMacOsCaStatus(): Promise<'trusted' | 'installed_untrusted' | 'not_installed'> {
  try {
    // 1. 检查证书是否存在于 keychain 中
    const { stdout: findOut } = await execAsync('security find-certificate -c "CC Look CA" -Z 2>/dev/null || true')
    const isInstalled = findOut.includes('CC Look CA') || findOut.includes('SHA-1')

    if (!isInstalled) {
      return 'not_installed'
    }

    // 2. 检查信任设置
    const { stdout: adminOut } = await execAsync('security dump-trust-settings -d 2>/dev/null || true')
    const { stdout: userOut } = await execAsync('security dump-trust-settings 2>/dev/null || true')

    const isTrusted = (text: string): boolean => {
      if (!text.includes('CC Look CA')) return false
      const blocks = text.split(/(?=Cert \d+:)/g)
      for (const block of blocks) {
        if (block.includes('CC Look CA') && /kSecTrustSettingsResultTrust(As)?Root/.test(block)) {
          return true
        }
      }
      return false
    }

    if (isTrusted(adminOut) || isTrusted(userOut)) return 'trusted'
    return 'installed_untrusted'
  } catch {
    return 'not_installed'
  }
}

async function getWindowsCaStatus(): Promise<'trusted' | 'installed_untrusted' | 'not_installed'> {
  try {
    const { stdout } = await execAsync('powershell.exe -Command "Get-ChildItem -Path Cert:\\LocalMachine\\Root | Where-Object { $_.Subject -like \"*CC Look CA*\" }"')
    if (!stdout.includes('CC Look CA')) return 'not_installed'

    const { stdout: trustOut } = await execAsync('powershell.exe -Command "$cert = Get-ChildItem -Path Cert:\\LocalMachine\\Root | Where-Object { $_.Subject -like \"*CC Look CA*\" }; if ($cert) { $cert | Format-List }"')
    // Windows 中存在于 Root store 通常意味着已信任，暂时统一返回 trusted
    return 'trusted'
  } catch {
    return 'not_installed'
  }
}

async function getSystemCaStatus(): Promise<'trusted' | 'installed_untrusted' | 'not_installed'> {
  const os = platform()
  if (os === 'darwin') {
    return getMacOsCaStatus()
  }
  if (os === 'win32') {
    return getWindowsCaStatus()
  }
  return 'not_installed'
}

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
    // 注册平台到代理管理器（跳过虚拟平台）
    if (platform.id !== 'cc-look') {
      proxyManager.registerPlatform(platform)
    }
    return platform
  })

  ipcMain.handle(IPC_CHANNELS.PLATFORM_UPDATE, async (_, id: string, updates: Partial<Platform>): Promise<Platform | null> => {
    console.log(`[IPC] 更新平台: ${id}`)
    if (id === 'cc-look') {
      // 只允许修改 enabled，禁止修改其他核心字段
      const safeUpdates: Partial<Platform> = {}
      if (updates.enabled !== undefined) {
        safeUpdates.enabled = updates.enabled
      }
      if (Object.keys(safeUpdates).length === 0) {
        console.log('[IPC] 虚拟平台 cc-look 不支持修改核心字段')
        return db.getPlatformById(id)
      }
      const platform = db.updatePlatform(id, safeUpdates)
      return platform
    }
    const platform = db.updatePlatform(id, updates)

    // 更新代理管理器中的平台配置
    if (platform) {
      proxyManager.registerPlatform(platform)
    }

    return platform
  })

  ipcMain.handle(IPC_CHANNELS.PLATFORM_DELETE, (_, id: string): boolean => {
    console.log(`[IPC] 删除平台: ${id}`)
    if (id === 'cc-look') {
      console.log('[IPC] 禁止删除虚拟平台 cc-look')
      return false
    }
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

    // 注册所有启用的平台（跳过虚拟的 cc-look 平台）
    const platforms = db.getAllPlatforms().filter(p => p.enabled && p.id !== 'cc-look')
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

  // 中止指定请求
  ipcMain.handle(IPC_CHANNELS.PROXY_ABORT, (_, requestId: string): boolean => {
    console.log(`[IPC] 中止请求: ${requestId}`)
    return proxyManager.abortRequest(requestId)
  })

  // 导出 MITM CA 证书
  ipcMain.handle(IPC_CHANNELS.PROXY_EXPORT_CA_CERT, (): string => {
    console.log('[IPC] 导出 CA 证书')
    return getCaCertPem()
  })

  // 测试 MITM 代理是否正常工作
  ipcMain.handle(IPC_CHANNELS.PROXY_TEST_MITM, async (): Promise<{ success: boolean; status?: number; message: string }> => {
    console.log('[IPC] 测试 MITM 代理')

    const trustStatus = await getSystemCaStatus()
    if (trustStatus === 'trusted') {
      return { success: true, message: '✅ 系统已信任 CC Look CA 证书' }
    }

    if (trustStatus === 'installed_untrusted') {
      return {
        success: false,
        message: '⚠️ CC Look CA 证书已安装，但系统尚未信任。实际客户端可能会报证书错误，请按照说明信任证书。'
      }
    }

    return {
      success: false,
      message: '❌ 未检测到 CC Look CA 证书，请先下载并安装证书。'
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

  ipcMain.handle(IPC_CHANNELS.LOG_SIZE, (): { count: number; sizeBytes: number } => {
    return db.getLogSize()
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
            const hasUpdate = compareVersions(latestVersion, APP_VERSION) > 0

            resolve({
              hasUpdate,
              currentVersion: APP_VERSION,
              latestVersion,
              releaseUrl: release.html_url,
              releaseNotes: release.body?.slice(0, 500) // 截取前500字符
            })
          } catch (error) {
            console.error('[IPC] 解析更新信息失败:', error)
            resolve({
              hasUpdate: false,
              currentVersion: APP_VERSION,
              latestVersion: APP_VERSION,
              releaseUrl: 'https://github.com/onekb/cc-look/releases'
            })
          }
        })
      })

      req.on('error', (error) => {
        console.error('[IPC] 检查更新失败:', error)
        resolve({
          hasUpdate: false,
          currentVersion: APP_VERSION,
          latestVersion: APP_VERSION,
          releaseUrl: 'https://github.com/onekb/cc-look/releases'
        })
      })

      req.setTimeout(10000, () => {
        req.destroy()
        resolve({
          hasUpdate: false,
          currentVersion: APP_VERSION,
          latestVersion: APP_VERSION,
          releaseUrl: 'https://github.com/onekb/cc-look/releases'
        })
      })

      req.end()
    })
  })

  // ==================== 自动启动代理服务 ====================

  // 注册所有启用的平台并启动代理服务（跳过虚拟的 cc-look 平台）
  const platforms = db.getAllPlatforms().filter(p => p.enabled && p.id !== 'cc-look')
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
