import { BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import * as db from './database'

interface FloatingWindowInfo {
  window: BrowserWindow
  requestId: string
  timeoutId: NodeJS.Timeout | null
  orderIndex: number
}

interface FloatingWindowPosition {
  x: number
  y: number
}

class FloatingWindowManager {
  private windows: Map<string, FloatingWindowInfo> = new Map()
  private windowWidth: number = 400
  private windowHeight: number = 200
  private windowGap: number = 10
  private isDev: boolean
  private nextOrderIndex: number = 0
  private basePosition: FloatingWindowPosition | null = null
  private dragStartBasePos: FloatingWindowPosition | null = null
  private isInitialized: boolean = false

  constructor() {
    this.isDev = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged
  }

  // 初始化 IPC 监听
  private initIpc() {
    if (this.isInitialized) return
    this.isInitialized = true

    // 拖拽开始
    ipcMain.on('floating:dragstart', (event) => {
      this.dragStartBasePos = { ...this.basePosition! }
      console.log('[FloatingWindow] 拖拽开始, basePos:', this.dragStartBasePos)
    })

    // 拖拽移动
    ipcMain.on('floating:drag', (event, delta: { dx: number; dy: number }) => {
      if (!this.dragStartBasePos) return

      const newBaseX = this.dragStartBasePos.x + delta.dx
      const newBaseY = this.dragStartBasePos.y + delta.dy

      // 更新所有窗口位置
      for (const info of this.windows.values()) {
        const newY = newBaseY + info.orderIndex * (this.windowHeight + this.windowGap)
        if (!info.window.isDestroyed()) {
          info.window.setPosition(newBaseX, newY)
        }
      }
    })

    // 拖拽结束
    ipcMain.on('floating:dragend', (event, delta: { dx: number; dy: number }) => {
      if (!this.dragStartBasePos) return

      // 保存最终位置
      this.basePosition = {
        x: this.dragStartBasePos.x + delta.dx,
        y: this.dragStartBasePos.y + delta.dy
      }
      this.savePosition(this.basePosition)
      this.dragStartBasePos = null

      console.log('[FloatingWindow] 拖拽结束, 新位置:', this.basePosition)
    })
  }

  // 获取保存的位置
  private getSavedPosition(): FloatingWindowPosition {
    const settings = db.getSettings()
    const saved = (settings as any).floatingWindowPosition as FloatingWindowPosition | undefined
    if (saved) {
      return saved
    }
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth } = primaryDisplay.workAreaSize
    return {
      x: screenWidth - this.windowWidth - 20,
      y: 100
    }
  }

  // 保存位置
  private savePosition(pos: FloatingWindowPosition) {
    db.setSettings({ floatingWindowPosition: pos } as any)
  }

  // 获取窗口应该显示的位置
  private getWindowPosition(orderIndex: number): FloatingWindowPosition {
    if (!this.basePosition) {
      this.basePosition = this.getSavedPosition()
    }
    return {
      x: this.basePosition.x,
      y: this.basePosition.y + orderIndex * (this.windowHeight + this.windowGap)
    }
  }

  // 创建或获取浮动窗口
  createWindow(requestId: string): BrowserWindow {
    this.initIpc()

    const existing = this.windows.get(requestId)
    if (existing) {
      if (existing.timeoutId) {
        clearTimeout(existing.timeoutId)
        existing.timeoutId = null
      }
      return existing.window
    }

    const orderIndex = this.nextOrderIndex++
    const pos = this.getWindowPosition(orderIndex)

    const window = new BrowserWindow({
      width: this.windowWidth,
      height: this.windowHeight,
      x: pos.x,
      y: pos.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focusable: true,
      show: false, // 先不显示，等待 load 完成后用 showInactive 显示
      webPreferences: {
        preload: join(__dirname, '../preload/floating.js'),
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    window.setAlwaysOnTop(true, 'floating')

    if (this.isDev && process.env['ELECTRON_RENDERER_URL']) {
      window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/floating.html`)
    } else {
      window.loadFile(join(__dirname, '../renderer/floating.html'))
    }

    // 无感弹出：页面加载完成后显示窗口但不抢占焦点
    window.webContents.on('did-finish-load', () => {
      window.showInactive()
    })

    this.windows.set(requestId, {
      window,
      requestId,
      timeoutId: null,
      orderIndex
    })

    window.on('closed', () => {
      const info = this.windows.get(requestId)
      const closedOrderIndex = info?.orderIndex ?? 0
      this.windows.delete(requestId)
      this.rearrangeWindows(closedOrderIndex)
    })

    console.log(`[FloatingWindow] 创建浮动窗口: ${requestId}, 位置: (${pos.x}, ${pos.y}), 顺序: ${orderIndex}`)

    return window
  }

  // 重新排列窗口（填补空位）
  private rearrangeWindows(closedOrderIndex: number) {
    for (const info of this.windows.values()) {
      if (info.orderIndex > closedOrderIndex) {
        info.orderIndex--
        const newPos = this.getWindowPosition(info.orderIndex)
        if (!info.window.isDestroyed()) {
          info.window.setPosition(newPos.x, newPos.y)
        }
      }
    }
    this.nextOrderIndex = this.windows.size > 0
      ? Math.max(...Array.from(this.windows.values()).map(i => i.orderIndex)) + 1
      : 0
  }

  // 发送内容到窗口
  sendContent(requestId: string, content: string, type: 'thinking' | 'content' | 'tool_use' | 'server_tool_use' | 'start' | 'end') {
    const info = this.windows.get(requestId)
    if (info && !info.window.isDestroyed()) {
      info.window.webContents.send('floating:content', { content, type })
    }
  }

  // 标记流式结束，开始倒计时关闭
  scheduleClose(requestId: string, delay: number = 3000) {
    const info = this.windows.get(requestId)
    if (!info) return

    if (info.timeoutId) {
      clearTimeout(info.timeoutId)
    }

    info.timeoutId = setTimeout(() => {
      this.fadeOutAndClose(requestId)
    }, delay)
  }

  // 渐变消失并关闭
  private fadeOutAndClose(requestId: string) {
    const info = this.windows.get(requestId)
    if (!info || info.window.isDestroyed()) return

    info.window.webContents.send('floating:fadeout')

    setTimeout(() => {
      const info = this.windows.get(requestId)
      if (info && !info.window.isDestroyed()) {
        info.window.close()
      }
    }, 500)
  }

  // 关闭指定窗口
  closeWindow(requestId: string) {
    const info = this.windows.get(requestId)
    if (info) {
      if (info.timeoutId) {
        clearTimeout(info.timeoutId)
      }
      if (!info.window.isDestroyed()) {
        info.window.close()
      }
    }
  }

  // 关闭所有窗口
  closeAll() {
    for (const [_requestId, info] of this.windows) {
      if (info.timeoutId) {
        clearTimeout(info.timeoutId)
      }
      if (!info.window.isDestroyed()) {
        info.window.close()
      }
    }
    this.windows.clear()
    this.nextOrderIndex = 0
  }

  // 检查是否启用
  isEnabled(): boolean {
    const settings = db.getSettings()
    return settings.floatingWindow === true
  }
}

export const floatingWindowManager = new FloatingWindowManager()
