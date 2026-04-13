import express, { type Request, type Response } from 'express'
import { type BrowserWindow } from 'electron'
import { type Platform, DEFAULT_SETTINGS } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import * as http from 'http'
import * as https from 'https'
import * as tls from 'tls'
import * as zlib from 'zlib'
import * as net from 'net'
import * as db from '../database'
import { sendStreamEvent } from '../ipc'
import { floatingWindowManager } from '../floatingWindow'
import { getOrGenerateCert } from './cert'

// 活跃请求信息
interface ActiveConnection {
  clientRes: Response        // 客户端响应对象
  proxyReq: http.ClientRequest // 代理请求对象
  platform: Platform
  mainWindow: BrowserWindow | null
  requestId: string
}

// 虚拟的 CC Look HTTP 代理平台（不受数据库控制）
const CC_LOOK_HTTP_PROXY_PLATFORM: Platform = {
  id: 'cc-look',
  name: 'CC Look HTTP Proxy',
  protocol: 'openai',
  baseUrl: '',
  pathPrefix: '',
  enabled: true,
  createdAt: 0,
  updatedAt: 0
}

export class ProxyManager {
  private server: http.Server | null = null
  private port: number = 5005
  private platforms: Map<string, Platform> = new Map()
  private isRunning: boolean = false
  private activeConnections: Map<string, ActiveConnection> = new Map()

  // 检查端口是否可用
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
          tester.once('close', () => resolve(true)).close()
        })
        .listen(port)
    })
  }

  // 设置端口
  setPort(port: number): void {
    this.port = port
  }

  // 获取端口
  getPort(): number {
    return this.port
  }

  // 获取运行状态
  getIsRunning(): boolean {
    return this.isRunning
  }

  // 添加或更新平台
  registerPlatform(platform: Platform): void {
    this.platforms.set(platform.id, platform)
    console.log(`[Proxy] 注册平台: ${platform.name}, 路径前缀: ${platform.pathPrefix}`)
  }

  // 移除平台
  unregisterPlatform(platformId: string): void {
    const platform = this.platforms.get(platformId)
    if (platform) {
      this.platforms.delete(platformId)
      console.log(`[Proxy] 注销平台: ${platform.name}`)
    }
  }

  // 根据路径查找平台
  private findPlatformByPath(path: string): Platform | null {
    // 按路径前缀长度降序排序，确保更长的前缀优先匹配
    const sortedPlatforms = Array.from(this.platforms.values())
      .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)

    for (const platform of sortedPlatforms) {
      if (path.startsWith(platform.pathPrefix)) {
        return platform
      }
    }
    return null
  }

  // 启动代理服务器
  async start(mainWindow: BrowserWindow | null): Promise<boolean> {
    // 如果服务器已在运行，直接返回成功
    if (this.isRunning && this.server) {
      console.log(`[Proxy] 服务器已在运行，端口: ${this.port}`)
      return true
    }

    // 检查端口是否可用
    const available = await this.isPortAvailable(this.port)
    if (!available) {
      console.error(`[Proxy] 端口 ${this.port} 已被占用`)
      return false
    }

    // 获取超时设置
    const settings = db.getSettings()
    const serverTimeout = settings.serverTimeout ?? DEFAULT_SETTINGS.serverTimeout
    const keepAliveTimeout = settings.keepAliveTimeout ?? DEFAULT_SETTINGS.keepAliveTimeout

    const app = express()
    app.use(express.json({ limit: '10mb' }))

    // DEBUG: 记录所有进入 Express 的请求
    app.use((req: Request, _res: Response, next) => {
      console.log(`[Proxy DEBUG] Express received: method=${req.method}, url="${req.url}", path="${req.path}", headers=${JSON.stringify(req.headers)}`)
      next();
    });

    // 请求计时和日志中间件
    app.use((req: Request, _res: Response, next) => {
      (req as any).startTime = Date.now();
      (req as any).requestBody = req.body;
      (req as any).requestId = uuidv4();
      next();
    });

    // 标准 HTTP 代理请求处理（请求行中包含完整 URL，如 GET http://example.com/path）
    app.use((req: Request, res: Response, next) => {
      const rawUrl = req.url
      console.log(`[Proxy Debug] app.use 命中: method=${req.method}, req.url="${rawUrl}", req.path="${req.path}"`)
      if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
        console.log(`[Proxy] 收到标准 HTTP 代理请求: ${req.method} ${rawUrl}`)
        this.handleHttpProxyRequest(req, res, mainWindow, rawUrl)
        return
      }
      next()
    })

    // 健康检查
    app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: Date.now(),
        platforms: Array.from(this.platforms.values()).map(p => ({
          name: p.name,
          pathPrefix: p.pathPrefix
        })),
        httpProxy: {
          enabled: true,
          platformId: CC_LOOK_HTTP_PROXY_PLATFORM.id
        }
      })
    })

    // 路由所有请求
    app.all('*', async (req: Request, res: Response) => {
      const platform = this.findPlatformByPath(req.path)

      if (platform) {
        await this.handleRequest(platform, req, res, mainWindow)
        return
      }

      // Fallback: 未匹配到平台时，尝试作为透明代理请求转发
      const rawUrl = req.url

      // Fallback 1: 标准 HTTP 代理格式（请求行中包含完整目标 URL）
      if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
        console.log(`[Proxy] 未匹配到平台，作为标准 HTTP 代理请求转发: ${req.method} ${rawUrl}`)
        await this.handleHttpProxyRequest(req, res, mainWindow, rawUrl)
        return
      }

      // Fallback 2: 根据 Host 头推断真实目标（匿名代理场景）
      const host = req.headers['host'] as string
      if (host) {
        const proxyHosts = [`127.0.0.1:${this.port}`, `localhost:${this.port}`]
        if (!proxyHosts.includes(host)) {
          const protocol = (req.headers['x-forwarded-proto'] as string) || 'http'
          const fallbackUrl = `${protocol}://${host}${rawUrl}`
          console.log(`[Proxy] 未匹配到平台，根据 Host 头匿名代理转发: ${req.method} ${fallbackUrl}`)
          await this.handleHttpProxyRequest(req, res, mainWindow, fallbackUrl)
          return
        }
      }

      // 仍无法处理
      console.log(`[Proxy] 未找到匹配的平台: ${req.path}`)
      res.status(404).json({
        error: 'Platform not found',
        path: req.path,
        availablePrefixes: Array.from(this.platforms.values()).map(p => p.pathPrefix)
      })
    })

    return new Promise((resolve) => {
      // 显式创建 http.Server，确保 connect 事件稳定触发
      // 注意：Node.js 收到 CONNECT 时会同时触发 request 和 connect 事件
      // 对于 CONNECT，res.end() 会向 socket 写入一个普通 HTTP 200 响应，
      // 这会和 'connect' 事件处理器写出的 "200 Connection Established" 冲突，
      // 导致 Node.js http.request 客户端读到 404 或异常响应。
      // 因此我们让 CONNECT 完全避开 Express，由 connect 事件独占 socket。
      this.server = http.createServer((req, res) => {
        console.log(`[Proxy DEBUG] http.createServer called: method=${req.method}, url="${req.url}"`)
        if (req.method === 'CONNECT') {
          console.log(`[Proxy DEBUG] CONNECT detected in http.createServer, returning without sending response`)
          // 不调用 res.end()，也不交给 Express，让 connect 事件接管 socket
          return
        }
        app(req, res)
      })

      this.server.on('connect', (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
        console.log(`[Proxy] 收到 CONNECT 请求: ${req.url}, head.length=${head ? head.length : 0}`)
        this.handleConnectRequest(req, clientSocket, head, mainWindow)
      })

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`[Proxy] 端口 ${this.port} 已被占用`)
        } else {
          console.error(`[Proxy] 启动失败:`, error)
        }
        this.isRunning = false
        resolve(false)
      })

      this.server.listen(this.port, () => {
        const addr = this.server!.address()
        console.log(`[Proxy] 代理服务器已启动，监听端口 ${this.port}, address=${JSON.stringify(addr)}`)
        console.log(`[Proxy] 已注册平台: ${Array.from(this.platforms.values()).map(p => `${p.name}(${p.pathPrefix})`).join(', ')}`)
        this.isRunning = true
        // 0 表示不限时
        this.server!.timeout = serverTimeout === 0 ? 0 : serverTimeout
        this.server!.keepAliveTimeout = keepAliveTimeout === 0 ? 0 : keepAliveTimeout
        console.log(`[Proxy] 超时设置 - 服务器: ${serverTimeout === 0 ? '不限时' : serverTimeout + 'ms'}, Keep-Alive: ${keepAliveTimeout === 0 ? '不限时' : keepAliveTimeout + 'ms'}`)
        resolve(true)
      })
    })
  }

  // 停止代理服务器
  stop(): boolean {
    if (!this.server || !this.isRunning) {
      return true
    }

    try {
      this.server.close()
      this.server = null
      this.isRunning = false
      console.log(`[Proxy] 代理服务器已停止`)
      return true
    } catch (error) {
      console.error(`[Proxy] 停止失败:`, error)
      return false
    }
  }

  // 获取状态
  getStatus(platformId: string) {
    const platform = this.platforms.get(platformId)
    if (!platform || !this.isRunning) {
      return { platformId, status: 'stopped' as const, localUrl: '' }
    }
    return {
      platformId,
      status: 'running' as const,
      localUrl: `http://localhost:${this.port}${platform.pathPrefix}`
    }
  }

  // 中止指定请求
  abortRequest(requestId: string): boolean {
    const connection = this.activeConnections.get(requestId)
    if (!connection) {
      console.log(`[Proxy] 未找到活跃请求: ${requestId}`)
      return false
    }

    console.log(`[Proxy] 中止请求: ${requestId}`)

    // 先移除连接记录，防止后续事件重新处理
    this.activeConnections.delete(requestId)

    // 关闭客户端响应，中断 SSE 连接
    try {
      if (!connection.clientRes.writableEnded && !connection.clientRes.destroyed) {
        connection.clientRes.end()
      }
    } catch (e) {
      // 忽略已关闭的响应
    }

    // 销毁代理请求（中断上游连接）
    connection.proxyReq.destroy(new Error('Request aborted by user'))

    // 关闭浮动窗口
    floatingWindowManager.sendContent(requestId, '', 'end')
    floatingWindowManager.scheduleClose(requestId, 1000)

    return true
  }

  // 处理标准 HTTP 代理请求（请求行中包含完整 URL）
  private async handleHttpProxyRequest(
    req: Request,
    res: Response,
    mainWindow: BrowserWindow | null,
    targetUrl: string
  ): Promise<void> {
    try {
      const url = new URL(targetUrl)
      const proxyPlatform: Platform = {
        ...CC_LOOK_HTTP_PROXY_PLATFORM,
        baseUrl: `${url.protocol}//${url.host}`
      }
      console.log(`[Proxy Debug] handleHttpProxyRequest 准备转发: platformId=${proxyPlatform.id}, baseUrl=${proxyPlatform.baseUrl}, actualPath=${url.pathname + url.search}`)
      await this.handleRequest(proxyPlatform, req, res, mainWindow, targetUrl, url.pathname + url.search)
    } catch (err) {
      console.error(`[Proxy] HTTP 代理请求处理失败:`, err)
      if (!res.headersSent) {
        res.status(400).json({ error: 'Invalid proxy target URL', message: (err as Error).message })
      }
    }
  }

  // 处理 CONNECT 请求（HTTPS 隧道代理）
  private handleConnectRequest(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
    mainWindow: BrowserWindow | null
  ): void {
    const startTime = Date.now()
    const requestId = uuidv4()
    const target = req.url || ''

    console.log(`[Proxy] 收到 CONNECT 请求: ${target}`)

    // 记录连接开始
    sendStreamEvent(mainWindow, {
      platformId: CC_LOOK_HTTP_PROXY_PLATFORM.id,
      requestId,
      type: 'start',
      timestamp: Date.now(),
      content: JSON.stringify({ method: 'CONNECT', target })
    })

    const [hostname, _portStr] = target.split(':')

    // 返回 200，让客户端开始与我们的 MITM 证书进行 TLS 握手
    console.log(`[Proxy DEBUG] Writing 200 Connection Established to socket for ${target}`)
    const written = clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    console.log(`[Proxy DEBUG] 200 write returned: ${written}`)

    // 为当前域名生成自签名证书
    const { key, cert } = getOrGenerateCert(hostname)
    console.log(`[Proxy DEBUG] Generated cert for hostname: ${hostname}`)

    // MITM TLS 服务端
    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      secureContext: tls.createSecureContext({ key, cert })
    })

    tlsSocket.on('error', (err) => {
      console.error(`[Proxy] MITM TLS 错误: ${target}`, err.message)
      if (!clientSocket.destroyed) clientSocket.destroy()
      sendStreamEvent(mainWindow, {
        platformId: CC_LOOK_HTTP_PROXY_PLATFORM.id,
        requestId,
        type: 'error',
        content: err.message,
        timestamp: Date.now()
      })
    })

    tlsSocket.once('secure', () => {
      console.log(`[Proxy] MITM TLS 握手成功: ${target}`)

      // 创建内部的 mini express 应用处理解密后的 HTTP 请求
      const mitmApp = express()
      mitmApp.use(express.json({ limit: '10mb' }))
      mitmApp.use((_req: Request, _res: Response, next) => {
        ;(_req as any).startTime = Date.now()
        ;(_req as any).requestBody = _req.body
        ;(_req as any).requestId = uuidv4()
        next()
      })

      mitmApp.all('*', async (innerReq: Request, innerRes: Response) => {
        console.log(`[Proxy] MITM 解密后请求: ${innerReq.method} ${innerReq.url}`)
        const proxyPlatform: Platform = {
          ...CC_LOOK_HTTP_PROXY_PLATFORM,
          baseUrl: `https://${hostname}`
        }
        await this.handleRequest(
          proxyPlatform,
          innerReq,
          innerRes,
          mainWindow,
          `https://${hostname}${innerReq.url}`,
          innerReq.url || '/'
        )
      })

      const mitmServer = http.createServer()
      mitmServer.on('request', (innerReq, innerRes) => {
        mitmApp(innerReq as any, innerRes as any, () => {})
      })
      console.log(`[Proxy DEBUG] Emitting 'connection' to mitmServer for ${target}`)
      mitmServer.emit('connection', tlsSocket)
      console.log(`[Proxy DEBUG] Emitted 'connection' to mitmServer for ${target}`)
    })

    clientSocket.on('close', () => {
      console.log(`[Proxy DEBUG] clientSocket closed for ${target}`)
      sendStreamEvent(mainWindow, {
        platformId: CC_LOOK_HTTP_PROXY_PLATFORM.id,
        requestId,
        type: 'end',
        timestamp: Date.now()
      })
    })

    clientSocket.on('error', (err) => {
      console.error(`[Proxy DEBUG] clientSocket error for ${target}:`, err.message)
    })
  }

  private async handleRequest(
    platform: Platform,
    req: Request,
    res: Response,
    mainWindow: BrowserWindow | null,
    targetUrlOverride?: string,
    actualPathOverride?: string
  ): Promise<void> {
    const startTime = (req as any).startTime || Date.now()
    const requestBody = (req as any).requestBody
    const requestId = (req as any).requestId || uuidv4()

    // 发送请求开始事件
    sendStreamEvent(mainWindow, {
      platformId: platform.id,
      requestId,
      type: 'start',
      timestamp: Date.now(),
      content: JSON.stringify({
        method: req.method,
        path: req.path,
        body: requestBody,
        baseUrl: platform.baseUrl
      })
    })

    // 去掉路径前缀，得到实际要转发的路径
    const actualPath = actualPathOverride || (req.path.slice(platform.pathPrefix.length) || '/')
    const targetUrl = targetUrlOverride || `${platform.baseUrl}${actualPath}`
    if (platform.id === 'cc-look') {
      console.log(`[Proxy Debug] cc-look handleRequest 开始处理: method=${req.method}, req.path="${req.path}", actualPath="${actualPath}", targetUrl="${targetUrl}", body=${JSON.stringify(requestBody).slice(0, 200)}`)
    }
    console.log(`[Proxy] ${platform.name} - 原始路径: ${req.path}, 去掉前缀后: ${actualPath}`)
    console.log(`[Proxy] ${platform.name} - 转发到: ${targetUrl}`)

    const url = new URL(targetUrl)
    const isHttps = url.protocol === 'https:'
    const httpModule = isHttps ? https : http

    // 准备请求头 - 直接转发客户端的所有请求头
    const headers: Record<string, string> = {}

    // 复制原始请求头，排除一些 hop-by-hop 头和可能导致问题的头
    const excludedHeaders = ['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'accept-encoding']
    for (const [key, value] of Object.entries(req.headers)) {
      if (!excludedHeaders.includes(key.toLowerCase())) {
        headers[key] = Array.isArray(value) ? value.join(', ') : (value as string)
      }
    }

    // 确保有必要的头
    if (!headers['content-type']) {
      headers['Content-Type'] = 'application/json'
    }
    if (!headers['accept']) {
      headers['Accept'] = 'application/json, text/event-stream'
    }

    // 准备请求体并设置 Content-Length
    let bodyString: string | undefined
    if (requestBody && Object.keys(requestBody).length > 0) {
      bodyString = JSON.stringify(requestBody)
      headers['Content-Length'] = Buffer.byteLength(bodyString).toString()
    }

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: req.method,
      headers
    }

    const proxyReq = httpModule.request(options, (proxyRes) => {
      const duration = Date.now() - startTime
      const statusCode = proxyRes.statusCode || 0
      const contentType = proxyRes.headers['content-type'] || ''
      const isStream = contentType.includes('text/event-stream')

      console.log(`[Proxy] ${platform.name} - 收到响应: ${statusCode} (${contentType})`)

      const responseHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (value) {
          responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value
          res.setHeader(key, responseHeaders[key])
        }
      }

      if (isStream) {
        // 浮动窗口 - 只在流式请求时创建
        const floatingEnabled = floatingWindowManager.isEnabled()
        console.log(`[Proxy] 流式请求, 浮动窗口启用: ${floatingEnabled}`)
        if (floatingEnabled) {
          console.log(`[Proxy] 创建浮动窗口: ${requestId}`)
          floatingWindowManager.createWindow(requestId)
          floatingWindowManager.sendContent(requestId, '', 'start')
          floatingWindowManager.sendTokens(requestId, null, 0)
        }
        this.handleStreamResponse(platform, req, res, proxyRes, mainWindow, requestId, responseHeaders, duration, headers, actualPath)
      } else {
        const chunks: Buffer[] = []
        proxyRes.on('data', (chunk) => chunks.push(chunk))
        proxyRes.on('end', () => {
          const buffer = Buffer.concat(chunks)

          // 检查是否是压缩的响应，如果是则不尝试解析为文本
          const contentEncoding = (proxyRes.headers['content-encoding'] || '').toLowerCase()
          const isCompressed = ['gzip', 'deflate', 'br'].some(enc => contentEncoding.includes(enc))

          // 只有未压缩的响应才转换为文本记录日志
          const responseBody = isCompressed ? `[压缩数据 ${buffer.length} bytes]` : buffer.toString('utf-8')

          this.createLog(platform, req, statusCode, responseBody, responseHeaders, duration, false, undefined, headers, actualPath)

          // 发送原始 buffer 给客户端
          res.status(statusCode).send(buffer)

          // 发送结束事件
          sendStreamEvent(mainWindow, {
            platformId: platform.id,
            requestId,
            type: 'end',
            timestamp: Date.now()
          })
        })
        proxyRes.on('error', (err) => {
          console.error(`[Proxy] 响应错误:`, err)
          this.createLog(platform, req, statusCode, undefined, responseHeaders, duration, false, err.message, headers, actualPath)
          sendStreamEvent(mainWindow, {
            platformId: platform.id,
            requestId,
            type: 'error',
            content: err.message,
            timestamp: Date.now()
          })

          if (res.headersSent) {
            res.end()
          } else {
            res.status(500).json({ error: 'Proxy response error', message: err.message })
          }

          sendStreamEvent(mainWindow, {
            platformId: platform.id,
            requestId,
            type: 'end',
            timestamp: Date.now()
          })
        })
      }
    })

    proxyReq.on('error', (err) => {
      const duration = Date.now() - startTime
      console.error(`[Proxy] 请求错误:`, err.message)
      this.createLog(platform, req, 0, undefined, {}, duration, false, err.message, headers, actualPath)

      sendStreamEvent(mainWindow, {
        platformId: platform.id,
        requestId,
        type: 'error',
        content: err.message,
        timestamp: Date.now()
      })

      if (!res.headersSent) {
        res.status(500).json({ error: 'Proxy error', message: err.message })
      } else {
        res.end()
      }

      sendStreamEvent(mainWindow, {
        platformId: platform.id,
        requestId,
        type: 'end',
        timestamp: Date.now()
      })
    })

    // 获取请求超时设置（0 表示不限时）
    const settings = db.getSettings()
    const requestTimeout = settings.requestTimeout ?? DEFAULT_SETTINGS.requestTimeout
    if (requestTimeout > 0) {
      proxyReq.setTimeout(requestTimeout, () => {
        console.error(`[Proxy] 请求超时 (${requestTimeout}ms)`)
        proxyReq.destroy(new Error('Request timeout'))
      })
    }

    if (requestBody && Object.keys(requestBody).length > 0) {
      const bodyString = JSON.stringify(requestBody)
      // 设置正确的 Content-Length
      headers['Content-Length'] = Buffer.byteLength(bodyString).toString()
      proxyReq.write(bodyString)
    }

    // 注册活跃连接
    this.activeConnections.set(requestId, {
      clientRes: res,
      proxyReq,
      platform,
      mainWindow,
      requestId
    })

    // 请求结束时移除连接记录
    const cleanup = () => {
      this.activeConnections.delete(requestId)
    }
    proxyReq.on('close', cleanup)

    proxyReq.end()
  }

  private handleStreamResponse(
    platform: Platform,
    req: Request,
    res: Response,
    proxyRes: http.IncomingMessage,
    mainWindow: BrowserWindow | null,
    requestId: string,
    responseHeaders: Record<string, string>,
    duration: number,
    requestHeaders: Record<string, string>,
    actualPath: string
  ): void {
    let fullContent = ''
    let sseBuffer = ''
    const chunks: Buffer[] = []
    const requestStartTime = (req as any).startTime || Date.now()
    let firstTokenTime: number | null = null
    let outputTokenCount = 0
    let displayInputTokens: number | null = null

    const sendFloatingTokens = () => {
      floatingWindowManager.sendTokens(requestId, displayInputTokens, outputTokenCount)
    }

    // 汇总流式输出的内容
    let aggregatedContent = ''
    let aggregatedThinking = ''  // 思考内容
    let aggregatedToolCalls: any[] = []  // 工具调用
    let aggregatedUsage: any = null

    let aggregatedModel: string | null = null
    let aggregatedId: string | null = null
    let aggregatedRole: string | null = null
    let aggregatedFinishReason: string | null = null

    // 检查是否是压缩的响应
    const contentEncoding = (proxyRes.headers['content-encoding'] || '').toLowerCase()
    const isCompressed = ['gzip', 'deflate', 'br'].some(enc => contentEncoding.includes(enc))

    console.log(`[Proxy] ${platform.name} - 开始流式响应 (压缩: ${isCompressed})`)

    // 创建解压流
    let decompressStream: NodeJS.ReadWriteStream
    if (contentEncoding.includes('gzip')) {
      decompressStream = zlib.createGunzip()
    } else if (contentEncoding.includes('deflate')) {
      decompressStream = zlib.createInflate()
    } else if (contentEncoding.includes('br')) {
      decompressStream = zlib.createBrotliDecompress()
    } else {
      decompressStream = null as any// 不需要解压
    }

    // 解析 SSE 数据并提取内容
    // 支持两种格式：
    // 1. 单行格式: data: {"type":"content_block_delta",...}
    // 2. 多行格式: event: content_block_delta\ndata: {"delta":{...}}
    const parseSseEvent = (eventType: string | null, data: string): void => {
      if (data === '[DONE]') return

      try {
        const parsed = JSON.parse(data)

        // 如果提供了 eventType，将其合并到 parsed 对象中
        // 这样无论服务端使用单行还是多行格式都能正确处理
        if (eventType && !parsed.type) {
          parsed.type = eventType
        }

        // 记录首次 token 时间
        if (firstTokenTime === null && hasContent(parsed)) {
          firstTokenTime = Date.now() - requestStartTime
        }

        // OpenAI 格式
        if (parsed.choices?.[0]?.delta?.content) {
          aggregatedContent += parsed.choices[0].delta.content
          outputTokenCount++
          sendFloatingTokens()
          // 浮动窗口
          floatingWindowManager.sendContent(requestId, parsed.choices[0].delta.content, 'content')
        }
        if (parsed.choices?.[0]?.finish_reason) {
          aggregatedFinishReason = parsed.choices[0].finish_reason
        }
        if (parsed.id) aggregatedId = parsed.id
        if (parsed.model) aggregatedModel = parsed.model
        if (parsed.choices?.[0]?.delta?.role) {
          aggregatedRole = parsed.choices[0].delta.role
        }
        if (parsed.usage) {
          aggregatedUsage = parsed.usage
          if (aggregatedUsage.prompt_tokens != null || aggregatedUsage.input_tokens != null) {
            displayInputTokens = aggregatedUsage.prompt_tokens ?? aggregatedUsage.input_tokens
            sendFloatingTokens()
          }
        }

        // OpenAI 工具调用格式
        if (parsed.choices?.[0]?.delta?.tool_calls) {
          for (const toolCall of parsed.choices[0].delta.tool_calls) {
            const index = toolCall.index ?? aggregatedToolCalls.length
            if (!aggregatedToolCalls[index]) {
              aggregatedToolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } }
            }
            if (toolCall.id) {
              aggregatedToolCalls[index].id = toolCall.id
            }
            if (toolCall.type) {
              aggregatedToolCalls[index].type = toolCall.type
            }
            if (toolCall.function?.name) {
              aggregatedToolCalls[index].function.name = toolCall.function.name
              // 浮动窗口 - 工具调用开始
              floatingWindowManager.sendContent(requestId, JSON.stringify({
                name: toolCall.function.name,
                input: {}
              }), 'tool_use')
              // 右侧工具详情浮窗
              floatingWindowManager.createToolWindow(requestId)
              floatingWindowManager.sendToolContent(requestId, JSON.stringify({
                name: toolCall.function.name,
                input: '{}'
              }))
            }
            if (toolCall.function?.arguments) {
              aggregatedToolCalls[index].function.arguments += toolCall.function.arguments
              // 右侧工具详情浮窗 - 实时更新参数
              floatingWindowManager.sendToolContent(requestId, JSON.stringify({
                name: aggregatedToolCalls[index].function.name,
                input: aggregatedToolCalls[index].function.arguments
              }))
            }
            outputTokenCount++
            sendFloatingTokens()
          }
        }

        // Anthropic 格式 - 多行SSE格式 (event: content_block_delta + data: {...})
        // 处理文本内容
        if ((parsed.type === 'content_block_delta' || eventType === 'content_block_delta') && parsed.delta?.text) {
          aggregatedContent += parsed.delta.text
          outputTokenCount++
          sendFloatingTokens()
          // 浮动窗口
          floatingWindowManager.sendContent(requestId, parsed.delta.text, 'content')
        }
        // Anthropic thinking 格式 - 多行SSE格式
        if ((parsed.type === 'content_block_delta' || eventType === 'content_block_delta') &&
            (parsed.delta?.type === 'thinking_delta' || parsed.delta?.thinking)) {
          const thinking = parsed.delta.thinking || parsed.delta.thinking_delta
          if (thinking) {
            aggregatedThinking += thinking
            outputTokenCount++
            sendFloatingTokens()
            // 浮动窗口
            floatingWindowManager.sendContent(requestId, thinking, 'thinking')
          }
        }
        // Anthropic 工具调用格式 - 开始 (支持 tool_use 和 server_tool_use)
        if ((parsed.type === 'content_block_start' || eventType === 'content_block_start') &&
            (parsed.content_block?.type === 'tool_use' || parsed.content_block?.type === 'server_tool_use')) {
          const index = parsed.index ?? aggregatedToolCalls.length
          aggregatedToolCalls[index] = {
            id: parsed.content_block.id || '',
            type: parsed.content_block.type,  // 保留原始类型
            name: parsed.content_block.name || '',
            input: ''
          }
          // 浮动窗口 - 工具调用开始
          floatingWindowManager.sendContent(requestId, JSON.stringify({
            name: parsed.content_block.name,
            input: {}
          }), parsed.content_block.type as 'tool_use' | 'server_tool_use')
          // 右侧工具详情浮窗
          floatingWindowManager.createToolWindow(requestId)
          floatingWindowManager.sendToolContent(requestId, JSON.stringify({
            name: parsed.content_block.name,
            input: '{}'
          }))
        }
        // Anthropic 工具调用格式 - 增量
        if ((parsed.type === 'content_block_delta' || eventType === 'content_block_delta') &&
            parsed.delta?.type === 'input_json_delta') {
          const index = parsed.index ?? 0
          if (aggregatedToolCalls[index]) {
            aggregatedToolCalls[index].input += parsed.delta.partial_json || ''
            outputTokenCount++
            sendFloatingTokens()
            // 右侧工具详情浮窗 - 实时更新参数
            floatingWindowManager.sendToolContent(requestId, JSON.stringify({
              name: aggregatedToolCalls[index].name,
              input: aggregatedToolCalls[index].input
            }))
          }
        }
        // Anthropic message_start - 多行SSE格式
        if (parsed.type === 'message_start' || eventType === 'message_start') {
          const message = parsed.message || parsed
          if (message.id) aggregatedId = message.id
          if (message.model) aggregatedModel = message.model
          if (message.role) aggregatedRole = message.role
          if (message.usage) {
            aggregatedUsage = {
              input_tokens: message.usage.input_tokens,
              cache_read_input_tokens: message.usage.cache_read_input_tokens,
              cache_creation_input_tokens: message.usage.cache_creation_input_tokens
            }
            if (message.usage.input_tokens != null) {
              displayInputTokens = message.usage.input_tokens
              sendFloatingTokens()
            }
          }
        }
        // Anthropic message_delta - 多行SSE格式
        if (parsed.type === 'message_delta' || eventType === 'message_delta') {
          if (parsed.usage) {
            aggregatedUsage = {
              ...aggregatedUsage,
              output_tokens: parsed.usage.output_tokens
            }
          }
          if (parsed.delta?.stop_reason) {
            aggregatedFinishReason = parsed.delta.stop_reason
          }
        }
      } catch {
        // ignore parse error
      }
    }

    // 检查是否有内容输出
    const hasContent = (parsed: any): boolean => {
      // OpenAI 格式
      if (parsed.choices?.[0]?.delta?.content) return true
      if (parsed.choices?.[0]?.delta?.tool_calls) return true
      // Anthropic 格式
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) return true
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') return true
      return false
    }

    // 处理解压后的数据（用于日志和SSE事件）
    const processDecompressedData = (data: string) => {
      fullContent += data
      sseBuffer += data

      // 解析 SSE 行
      // 支持两种格式：
      // 1. 单行格式: data: {"type":"content_block_delta",...}
      // 2. 多行格式: event: content_block_delta\ndata: {"delta":{...}}
      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() || ''

      let currentEventType: string | null = null

      for (const line of lines) {
        if (line.startsWith('event:')) {
          // 记录事件类型
          currentEventType = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          // 处理数据行，传入之前记录的事件类型
          const content = line.slice(5).trim()
          parseSseEvent(currentEventType, content)

          sendStreamEvent(mainWindow, {
            platformId: platform.id,
            requestId,
            type: 'delta',
            content,
            timestamp: Date.now()
          })

          // 重置事件类型
          currentEventType = null
        } else if (line.trim() && !line.startsWith(':')) {
          // 其他非注释行，可能是原始数据
          sendStreamEvent(mainWindow, {
            platformId: platform.id,
            requestId,
            type: 'delta',
            content: line,
            timestamp: Date.now()
          })
        }
      }
    }

    // 构建汇总的流式输出数据
    const buildAggregatedData = (): any => {
      const result: any = {}

      if (aggregatedId) result.id = aggregatedId
      if (aggregatedModel) result.model = aggregatedModel
      if (aggregatedRole) result.role = aggregatedRole
      if (aggregatedThinking) result.thinking = aggregatedThinking
      if (aggregatedContent) result.content = aggregatedContent
      if (aggregatedToolCalls.length > 0) {
        // 解析 Anthropic 格式的 input JSON 字符串
        result.tool_calls = aggregatedToolCalls.map(tc => {
          if (tc.input && typeof tc.input === 'string') {
            try {
              return { ...tc, input: JSON.parse(tc.input) }
            } catch {
              return tc
            }
          }
          // OpenAI 格式的 arguments 也是字符串，需要解析
          if (tc.function?.arguments && typeof tc.function.arguments === 'string') {
            try {
              return {
                ...tc,
                function: { ...tc.function, arguments: JSON.parse(tc.function.arguments) }
              }
            } catch {
              return tc
            }
          }
          return tc
        })
      }
      if (aggregatedFinishReason) result.finish_reason = aggregatedFinishReason
      if (aggregatedUsage) result.usage = aggregatedUsage

      return result
    }

    // 计算最终统计信息并创建日志
    const finalizeLog = (error?: string) => {
      // 计算 token/s（从首 token 开始计算）
      const totalDuration = Date.now() - requestStartTime
      const tokenGenerationDuration = firstTokenTime !== null
        ? totalDuration - firstTokenTime
        : totalDuration
      const tokensPerSecond = outputTokenCount > 0 && tokenGenerationDuration > 0
        ? (outputTokenCount / (tokenGenerationDuration / 1000))
        : null

      // 从请求体中提取 input tokens（如果有）
      const requestBody = (req as any).requestBody
      let inputTokens: number | undefined
      let cacheReadInputTokens: number | undefined
      if (requestBody?.messages) {
        // 粗略估算：每个字符约 0.25 tokens
        const messageStr = JSON.stringify(requestBody.messages)
        inputTokens = Math.ceil(messageStr.length * 0.25)
      }

      // 从汇总的 usage 中提取更准确的 token 统计
      if (aggregatedUsage) {
        if (aggregatedUsage.prompt_tokens) {
          inputTokens = aggregatedUsage.prompt_tokens
        }
        if (aggregatedUsage.input_tokens) {
          inputTokens = aggregatedUsage.input_tokens
        }
        if (aggregatedUsage.completion_tokens) {
          outputTokenCount = aggregatedUsage.completion_tokens
        }
        if (aggregatedUsage.output_tokens) {
          outputTokenCount = aggregatedUsage.output_tokens
        }
        if (aggregatedUsage.cache_read_input_tokens) {
          cacheReadInputTokens = aggregatedUsage.cache_read_input_tokens
        }
      }

      // 构建汇总数据
      const streamData = buildAggregatedData()

      this.createLog(
        platform, req, proxyRes.statusCode || 0,
        fullContent.slice(0, 50000),
        responseHeaders, duration, true,
        error, requestHeaders, actualPath,
        Object.keys(streamData).length > 0 ? JSON.stringify(streamData, null, 2) : undefined,
        inputTokens, outputTokenCount, cacheReadInputTokens, firstTokenTime, tokensPerSecond
      )
    }

    if (isCompressed && decompressStream) {
      // 压缩响应：解压后处理文本，转发原始压缩数据
      decompressStream.on('data', (chunk: Buffer) => {
        processDecompressedData(chunk.toString('utf-8'))
      })

      proxyRes.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        decompressStream.write(chunk)
        res.write(chunk)
      })

      proxyRes.on('end', () => {
        decompressStream.end()
      })

      decompressStream.on('end', () => {
        console.log(`[Proxy] ${platform.name} - 流式响应结束`)
        finalizeLog()

        sendStreamEvent(mainWindow, {
          platformId: platform.id,
          requestId,
          type: 'end',
          timestamp: Date.now()
        })

        // 浮动窗口 - 流式结束
        floatingWindowManager.sendContent(requestId, '', 'end')
        floatingWindowManager.scheduleClose(requestId)

        res.end()
      })

      decompressStream.on('error', (err) => {
        console.error(`[Proxy] 解压错误:`, err)
        const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0)
        finalizeLog(`解压失败，原始数据 ${totalBytes} bytes`)

        sendStreamEvent(mainWindow, {
          platformId: platform.id,
          requestId,
          type: 'end',
          timestamp: Date.now()
        })

        // 浮动窗口 - 错误结束
        floatingWindowManager.sendContent(requestId, '', 'end')
        floatingWindowManager.scheduleClose(requestId, 1000)

        res.end()
        proxyRes.destroy()
      })
    } else {
      // 未压缩响应：直接处理
      proxyRes.on('data', (chunk: Buffer) => {
        const data = chunk.toString('utf-8')
        processDecompressedData(data)
        res.write(chunk)
      })

      proxyRes.on('end', () => {
        console.log(`[Proxy] ${platform.name} - 流式响应结束`)
        finalizeLog()

        sendStreamEvent(mainWindow, {
          platformId: platform.id,
          requestId,
          type: 'end',
          timestamp: Date.now()
        })

        // 浮动窗口 - 流式结束
        floatingWindowManager.sendContent(requestId, '', 'end')
        floatingWindowManager.scheduleClose(requestId)

        res.end()
      })
    }

    proxyRes.on('error', (err) => {
      console.error(`[Proxy] 流式响应错误:`, err)
      finalizeLog(err.message)

      sendStreamEvent(mainWindow, {
        platformId: platform.id,
        requestId,
        type: 'error',
        content: err.message,
        timestamp: Date.now()
      })

      // 浮动窗口 - 错误结束
      floatingWindowManager.sendContent(requestId, '', 'end')
      floatingWindowManager.scheduleClose(requestId, 1000)

      res.end()

      sendStreamEvent(mainWindow, {
        platformId: platform.id,
        requestId,
        type: 'end',
        timestamp: Date.now()
      })
    })
  }

  private createLog(
    platform: Platform,
    req: Request,
    responseStatus: number,
    responseBody: string | undefined,
    responseHeaders: Record<string, string>,
    duration: number,
    isStream: boolean,
    error?: string,
    filteredHeaders?: Record<string, string>,
    actualPath?: string,
    streamData?: string,
    inputTokens?: number,
    outputTokens?: number,
    cacheReadInputTokens?: number,
    firstTokenTime?: number | null,
    tokensPerSecond?: number | null
  ): void {
    try {
      const requestBody = (req as any).requestBody
      // 使用去掉前缀后的实际路径
      const logPath = actualPath || req.path

      // 使用过滤后的请求头（如果提供）
      const requestHeaders = filteredHeaders || {}

      console.log(`[Proxy Debug] createLog called: platformId=${platform.id}, name=${platform.name}, status=${responseStatus}, path=${logPath}, duration=${duration}, error=${error || 'none'}`)

      db.createLog({
        platformId: platform.id,
        baseUrl: platform.baseUrl,
        method: req.method || 'GET',
        path: logPath,
        requestHeaders,
        requestBody: requestBody ? JSON.stringify(requestBody, null, 2) : undefined,
        responseStatus,
        responseHeaders,
        responseBody,
        streamData,
        duration,
        isStream,
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        firstTokenTime: firstTokenTime ?? undefined,
        tokensPerSecond: tokensPerSecond ?? undefined,
        error
      })

      console.log(`[Proxy] ${platform.name} - 日志已创建: ${req.method} ${logPath} -> ${responseStatus} (${duration}ms)`)
    } catch (err) {
      console.error(`[Proxy] 创建日志失败:`, err)
    }
  }
}
