import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type Platform, type RequestLog, type AppSettings, type StreamEvent, type PlatformProxy, type UpdateCheckResult } from '@shared/types'

// 暴露给渲染进程的 API
const api = {
  // 平台管理
  platform: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.PLATFORM_GET_ALL) as Promise<Platform[]>,
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PLATFORM_GET, id) as Promise<Platform | null>,
    create: (platform: Omit<Platform, 'id' | 'createdAt' | 'updatedAt'>) =>
      ipcRenderer.invoke(IPC_CHANNELS.PLATFORM_CREATE, platform) as Promise<Platform>,
    update: (id: string, updates: Partial<Platform>) =>
      ipcRenderer.invoke(IPC_CHANNELS.PLATFORM_UPDATE, id, updates) as Promise<Platform | null>,
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PLATFORM_DELETE, id) as Promise<boolean>,
    toggle: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PLATFORM_TOGGLE, id) as Promise<Platform | null>
  },

  // 代理服务
  proxy: {
    start: (platformId: string) => ipcRenderer.invoke(IPC_CHANNELS.PROXY_START, platformId) as Promise<boolean>,
    stop: (platformId: string) => ipcRenderer.invoke(IPC_CHANNELS.PROXY_STOP, platformId) as Promise<boolean>,
    status: (platformId: string) => ipcRenderer.invoke(IPC_CHANNELS.PROXY_STATUS, platformId) as Promise<PlatformProxy | null>,
    onStream: (callback: (event: StreamEvent) => void) => {
      const handler = (_: unknown, data: StreamEvent) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.PROXY_STREAM, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PROXY_STREAM, handler)
    }
  },

  // 日志
  log: {
    getAll: (limit?: number, offset?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.LOG_GET_ALL, limit, offset) as Promise<RequestLog[]>,
    getByPlatform: (platformId: string, limit?: number, offset?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.LOG_GET_BY_PLATFORM, platformId, limit, offset) as Promise<RequestLog[]>,
    clear: (platformId?: string) => ipcRenderer.invoke(IPC_CHANNELS.LOG_CLEAR, platformId) as Promise<boolean>,
    export: (format: 'json' | 'csv', platformId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.LOG_EXPORT, format, platformId) as Promise<string>
  },

  // 设置
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET) as Promise<AppSettings>,
    set: (settings: Partial<AppSettings>) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings) as Promise<AppSettings>
  },

  // 调试
  debug: {
    testFloatingWindow: () => ipcRenderer.invoke('debug:testFloatingWindow') as Promise<void>
  },

  // 更新检查
  update: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK) as Promise<UpdateCheckResult>
  }
}

// 通过 contextBridge 暴露 API
contextBridge.exposeInMainWorld('api', api)

// 类型声明
export type { api }
