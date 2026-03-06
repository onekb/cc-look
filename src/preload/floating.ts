import { contextBridge, ipcRenderer } from 'electron'

// 浮动窗口的 API
contextBridge.exposeInMainWorld('floatingApi', {
  onContent: (callback: (data: { content: string; type: string }) => void) => {
    ipcRenderer.on('floating:content', (_, data) => callback(data))
  },
  onFadeout: (callback: () => void) => {
    ipcRenderer.on('floating:fadeout', () => callback())
  },
  // 拖拽支持
  startDrag: () => {
    ipcRenderer.send('floating:drag:start')
  }
})
