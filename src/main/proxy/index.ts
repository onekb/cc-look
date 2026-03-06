import express, { type Request, type Response } from 'express'
import { type BrowserWindow } from 'electron'
import { type Platform } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import * as http from 'http'
import * as https from 'https'
import * as zlib from 'zlib'
import * as net from 'net'
import * as db from '../database'
import { sendStreamEvent } from '../ipc'

export class ProxyManager {
  private server: http.Server | null = null
  private port: number = 3100
  private platforms: Map<string, Platform> = new Map()
  private isRunning: boolean = false

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

    const app = express()
    app.use(express.json({ limit: '10mb' }))

    // 请求计时和日志中间件
    app.use((req: Request, _res: Response, next) => {
      (req as any).startTime = Date.now();
      (req as any).requestBody = req.body;
      (req as any).requestId = uuidv4();
      next();
    });

    // 健康检查
    app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: Date.now(),
        platforms: Array.from(this.platforms.values()).map(p => ({
          name: p.name,
          pathPrefix: p.pathPrefix
        }))
      })
    })

    // 路由所有请求
    app.all('*', async (req: Request, res: Response) => {
      const platform = this.findPlatformByPath(req.path)

      if (!platform) {
        console.log(`[Proxy] 未找到匹配的平台: ${req.path}`)
        res.status(404).json({
          error: 'Platform not found',
          path: req.path,
          availablePrefixes: Array.from(this.platforms.values()).map(p => p.pathPrefix)
        })
        return
      }

      await this.handleRequest(platform, req, res, mainWindow)
    })

    return new Promise((resolve) => {
      this.server = app.listen(this.port, () => {
        console.log(`[Proxy] 代理服务器已启动，监听端口 ${this.port}`)
        console.log(`[Proxy] 已注册平台: ${Array.from(this.platforms.values()).map(p => `${p.name}(${p.pathPrefix})`).join(', ')}`)
        this.isRunning = true
        if (this.server) {
          this.server.timeout = 120000
          this.server.keepAliveTimeout = 65000
        }
        resolve(true)
      })

      this.server?.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`[Proxy] 端口 ${this.port} 已被占用`)
        } else {
          console.error(`[Proxy] 启动失败:`, error)
        }
        this.isRunning = false
        resolve(false)
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

  private async handleRequest(
    platform: Platform,
    req: Request,
    res: Response,
    mainWindow: BrowserWindow | null
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
        body: requestBody
      })
    })

    // 去掉路径前缀，得到实际要转发的路径
    const actualPath = req.path.slice(platform.pathPrefix.length) || '/'
    const targetUrl = `${platform.baseUrl}${actualPath}`
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
      }
    })

    proxyReq.setTimeout(120000, () => {
      console.error(`[Proxy] 请求超时`)
      proxyReq.destroy(new Error('Request timeout'))
    })

    if (requestBody && Object.keys(requestBody).length > 0) {
      const bodyString = JSON.stringify(requestBody)
      // 设置正确的 Content-Length
      headers['Content-Length'] = Buffer.byteLength(bodyString).toString()
      proxyReq.write(bodyString)
    }
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

    // 汇总流式输出的内容
    let aggregatedContent = ''
    let aggregatedThinking = ''  // 思考内容
    let aggregatedUsage: any = null
    let aggregatedCacheReadInputTokens: number | null = null
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
    const parseSseEvent = (data: string): void => {
      if (data === '[DONE]') return

      try {
        const parsed = JSON.parse(data)

        // 记录首次 token 时间
        if (firstTokenTime === null && hasContent(parsed)) {
          firstTokenTime = Date.now() - requestStartTime
        }

        // OpenAI 格式
        if (parsed.choices?.[0]?.delta?.content) {
          aggregatedContent += parsed.choices[0].delta.content
          outputTokenCount++
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
        }

        // Anthropic 格式
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          aggregatedContent += parsed.delta.text
          outputTokenCount++
        }
        // Anthropic thinking 格式
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'thinking_delta' && parsed.delta?.thinking) {
          aggregatedThinking += parsed.delta.thinking
          outputTokenCount++
        }
        if (parsed.type === 'message_start' && parsed.message) {
          if (parsed.message.id) aggregatedId = parsed.message.id
          if (parsed.message.model) aggregatedModel = parsed.message.model
          if (parsed.message.role) aggregatedRole = parsed.message.role
          if (parsed.message.usage) {
            aggregatedUsage = {
              input_tokens: parsed.message.usage.input_tokens,
              cache_read_input_tokens: parsed.message.usage.cache_read_input_tokens,
              cache_creation_input_tokens: parsed.message.usage.cache_creation_input_tokens
            }
          }
        }
        if (parsed.type === 'message_delta' && parsed.usage) {
          aggregatedUsage = {
            ...aggregatedUsage,
            output_tokens: parsed.usage.output_tokens
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
      // Anthropic 格式
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) return true
      return false
    }

    // 处理解压后的数据（用于日志和SSE事件）
    const processDecompressedData = (data: string) => {
      fullContent += data
      sseBuffer += data

      // 解析 SSE 行
      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const content = line.slice(6).trim()
          parseSseEvent(content)

          sendStreamEvent(mainWindow, {
            platformId: platform.id,
            requestId,
            type: 'delta',
            content,
            timestamp: Date.now()
          })
        } else if (line.trim() && !line.startsWith(':')) {
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

        res.end()
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

      console.log(`[Proxy Debug] baseUrl: ${platform.baseUrl}`)
      console.log(`[Proxy Debug] pathPrefix: ${platform.pathPrefix}`)
      console.log(`[Proxy Debug] req.path: ${req.path}`)
      console.log(`[Proxy Debug] actualPath: ${logPath}`)

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
