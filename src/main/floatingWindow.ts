import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

interface FloatingWindowInfo {
  window: BrowserWindow
  requestId: string
  timeoutId: NodeJS.Timeout | null
  yPosition: number
}

class FloatingWindowManager {
  private windows: Map<string, FloatingWindowInfo> = new Map()
  private baseY: number = 100  // 基础 Y 坐标
  private windowWidth: number = 400
  private windowHeight: number = 200
  private windowGap: number = 10  // 窗口之间的间距
  private isDev: boolean

  constructor() {
    this.isDev = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged
  }

  // 创建或获取浮动窗口
  createWindow(requestId: string): BrowserWindow {
    // 如果已存在，直接返回
    const existing = this.windows.get(requestId)
    if (existing) {
      // 清除自动关闭的定时器
      if (existing.timeoutId) {
        clearTimeout(existing.timeoutId)
        existing.timeoutId = null
      }
      return existing.window
    }

    // 计算窗口位置（屏幕右侧）
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

    // 计算当前窗口应该放置的 Y 坐标
    let yPosition = this.baseY
    const existingWindows = Array.from(this.windows.values())
    if (existingWindows.length > 0) {
      // 找到最下面的窗口，在其下方放置新窗口
      const lowestWindow = existingWindows.reduce((prev, curr) =>
        curr.yPosition > prev.yPosition ? curr : prev
      )
      yPosition = lowestWindow.yPosition + this.windowHeight + this.windowGap

      // 如果超出屏幕，重新从顶部开始
      if (yPosition + this.windowHeight > screenHeight - 50) {
        yPosition = this.baseY
      }
    }

    const xPosition = screenWidth - this.windowWidth - 20

    const window = new BrowserWindow({
      width: this.windowWidth,
      height: this.windowHeight,
      x: xPosition,
      y: yPosition,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/floating.js'),
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    // 设置窗口不参与任务栏切换
    window.setAlwaysOnTop(true, 'floating')

    // 加载浮动窗口页面
    if (this.isDev && process.env['ELECTRON_RENDERER_URL']) {
      window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/floating.html`)
    } else {
      window.loadFile(join(__dirname, '../renderer/floating.html'))
    }

    // 存储窗口信息
    this.windows.set(requestId, {
      window,
      requestId,
      timeoutId: null,
      yPosition
    })

    // 窗口关闭时清理
    window.on('closed', () => {
      this.windows.delete(requestId)
    })

    console.log(`[FloatingWindow] 创建浮动窗口: ${requestId}, 位置: (${xPosition}, ${yPosition})`)

    return window
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

    // 清除之前的定时器
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

    // 通知渲染进程开始渐变
    info.window.webContents.send('floating:fadeout')

    // 500ms 后关闭窗口（与 CSS 动画时间一致）
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
  }

  // 检查是否启用
  isEnabled(): boolean {
    const { db } = require('./database')
    const settings = db.getSettings()
    return settings.floatingWindow === true
  }
}

// 单例
export const floatingWindowManager = new FloatingWindowManager()
