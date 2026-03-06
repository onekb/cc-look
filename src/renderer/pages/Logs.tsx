import { useEffect, useState, useRef } from 'react'
import { useLogStore, type ActiveRequest } from '../stores/platform'
import type { RequestLog } from '@shared/types'

export default function Logs() {
  const {
    platforms,
    logs,
    activeRequests,
    loading,
    fetchPlatforms,
    fetchLogs,
    clearLogs,
    exportLogs,
    subscribeToStream,
    proxyStatuses
  } = useLogStore()

  const [selectedLog, setSelectedLog] = useState<RequestLog | ActiveRequest | null>(null)
  const [selectedType, setSelectedType] = useState<'active' | 'history'>('active')
  const [filter, setFilter] = useState({ platformId: '', status: '' })
  const [expandedActiveRequest, setExpandedActiveRequest] = useState<string | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    console.log('[Logs] Component mounted, setting up stream subscription')
    fetchPlatforms()
    fetchLogs()

    // 订阅流事件
    const unsubscribe = subscribeToStream()
    console.log('[Logs] Stream subscription set up')

    return () => {
      console.log('[Logs] Component unmounting, cleaning up subscription')
      unsubscribe()
    }
  }, [fetchPlatforms, fetchLogs, subscribeToStream])

  // 自动滚动活动请求的内容
  useEffect(() => {
    if (expandedActiveRequest && logContainerRef.current) {
      const element = logContainerRef.current.querySelector(`#active-${expandedActiveRequest}`)
      if (element) {
        element.scrollTop = element.scrollHeight
      }
    }
  }, [activeRequests, expandedActiveRequest])

  const handleClearLogs = async () => {
    if (confirm('确定要清空所有日志吗？')) {
      await clearLogs()
    }
  }

  const handleExport = async (format: 'json' | 'csv') => {
    const content = await exportLogs(format)
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs_${new Date().toISOString().split('T')[0]}.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const formatDuration = (ms: number) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatTokenSpeed = (tokensPerSecond: number | undefined | null) => {
    if (!tokensPerSecond) return '-'
    return `${tokensPerSecond.toFixed(1)} tok/s`
  }

  const formatFirstTokenTime = (ms: number | undefined | null) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-green-600 bg-green-100'
    if (status >= 400 && status < 500) return 'text-yellow-600 bg-yellow-100'
    if (status >= 500) return 'text-red-600 bg-red-100'
    return 'text-gray-600 bg-gray-100'
  }

  const formatJson = (str: string | undefined): string => {
    if (!str) return ''
    try {
      return JSON.stringify(JSON.parse(str), null, 2)
    } catch {
      return str
    }
  }

  const getPlatformName = (platformId: string) => {
    return platforms.find(p => p.id === platformId)?.name || 'Unknown'
  }

  const getProxyStatus = (platformId: string) => {
    return proxyStatuses.get(platformId)?.status || 'stopped'
  }

  // 过滤日志
  const filteredLogs = logs.filter((log) => {
    if (filter.status === 'success' && (log.responseStatus < 200 || log.responseStatus >= 300)) return false
    if (filter.status === 'error' && log.responseStatus < 400) return false
    if (filter.platformId && log.platformId !== filter.platformId) return false
    return true
  })

  // 渲染活动请求
  const renderActiveRequest = (request: ActiveRequest) => {
    const isExpanded = expandedActiveRequest === request.requestId
    const duration = Date.now() - request.startTime

    return (
      <div
        key={request.requestId}
        id={`active-${request.requestId}`}
        className={`bg-yellow-50 border-2 border-yellow-300 rounded-lg overflow-hidden ${
          request.status === 'error' ? 'bg-red-50 border-red-300' : ''
        }`}
      >
        {/* 请求头部 */}
        <div
          className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-yellow-100"
          onClick={() => setExpandedActiveRequest(isExpanded ? null : request.requestId)}
        >
          <div className="flex items-center gap-3">
            {/* 动画指示器 */}
            <div className={`w-3 h-3 rounded-full ${
              request.status === 'streaming' ? 'bg-green-500 animate-pulse' :
              request.status === 'error' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'
            }`} />

            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{request.platformName}</span>
                <span className="text-xs text-gray-500">{request.method} {request.path}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                进行中 · {formatDuration(duration)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded">
              {request.rawContent.length} chunks
            </span>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* 展开的原始内容 */}
        {isExpanded && (
          <div className="border-t border-yellow-200">
            <div className="px-4 py-2 bg-yellow-100 text-xs font-medium text-yellow-800">
              实时 SSE 数据
            </div>
            <div
              ref={logContainerRef}
              className="p-3 bg-gray-900 text-gray-300 font-mono text-xs max-h-64 overflow-auto"
            >
              {request.rawContent.length === 0 ? (
                <div className="text-gray-500">等待数据...</div>
              ) : (
                request.rawContent.map((content, index) => (
                  <div key={index} className="mb-1">
                    <span className="text-gray-500">{index + 1}:</span>{' '}
                    <span className="text-green-400">{content}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // 渲染历史日志
  const renderHistoryLog = (log: RequestLog) => {
    const isSelected = selectedLog && selectedType === 'history' && (selectedLog as RequestLog).id === log.id

    return (
      <div
        key={log.id}
        onClick={() => {
          setSelectedLog(log)
          setSelectedType('history')
        }}
        className={`bg-white rounded-lg p-3 border cursor-pointer hover:shadow-md transition-shadow ${
          isSelected ? 'border-primary-500 shadow-md' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* 状态点 */}
            <span className={`status-dot ${
              log.responseStatus >= 200 && log.responseStatus < 300 ? 'running' : 'stopped'
            }`} />

            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{getPlatformName(log.platformId)}</span>
                <span className="text-xs text-gray-500">{log.method} {log.path}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {new Date(log.createdAt).toLocaleString()} · {formatDuration(log.duration)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Token 统计 */}
            {(log.inputTokens || log.outputTokens) && (
              <span className="text-xs text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded" title="输入/输出 tokens">
                {log.inputTokens || 0}/{log.outputTokens || 0}
              </span>
            )}
            {/* 首Token时间 */}
            {log.firstTokenTime && (
              <span className="text-xs text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded" title="首 Token 时间">
                TTFT: {formatFirstTokenTime(log.firstTokenTime)}
              </span>
            )}
            {/* 输出速度 */}
            {log.tokensPerSecond && (
              <span className="text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded" title="输出速度">
                {formatTokenSpeed(log.tokensPerSecond)}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(log.responseStatus)}`}>
              {log.responseStatus}
            </span>
            {log.isStream && (
              <span className="text-xs text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">Stream</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  // 渲染详情面板
  const renderDetailPanel = () => {
    if (!selectedLog) return null

    if (selectedType === 'active') {
      const request = selectedLog as ActiveRequest
      return (
        <div className="w-96 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-yellow-50 flex items-center justify-between">
            <span className="font-medium">实时请求详情</span>
            <button
              onClick={() => setSelectedLog(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4">
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-gray-500 text-xs">平台</div>
                <div className="font-medium">{request.platformName}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">路径</div>
                <div className="font-mono text-xs">{request.method} {request.path}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">持续时间</div>
                <div>{formatDuration(Date.now() - request.startTime)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs mb-2">原始数据 ({request.rawContent.length} 条)</div>
                <div className="bg-gray-900 text-gray-300 p-3 rounded font-mono text-xs max-h-60 overflow-auto">
                  {request.rawContent.map((content, index) => (
                    <div key={index} className="mb-1">
                      <span className="text-gray-500">[{index + 1}]</span> {content}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // 历史日志详情
    const log = selectedLog as RequestLog

    // 生成 curl 命令
    const generateCurl = (log: RequestLog): string => {
      const url = `${log.baseUrl}${log.path}`
      let curl = `curl '${url}'`

      // 添加请求方法
      if (log.method !== 'GET') {
        curl += ` \\\n  -X ${log.method}`
      }

      // 添加请求头
      if (log.requestHeaders && Object.keys(log.requestHeaders).length > 0) {
        for (const [key, value] of Object.entries(log.requestHeaders)) {
          curl += ` \\\n  -H '${key}: ${value}'`
        }
      }

      // 添加请求体
      if (log.requestBody) {
        const body = log.requestBody.replace(/'/g, "'\\''")
        curl += ` \\\n  -d '${body}'`
      }

      return curl
    }

    const copyCurl = (log: RequestLog) => {
      const curl = generateCurl(log)
      navigator.clipboard.writeText(curl)
    }

    return (
      <div className="w-96 bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <span className="font-medium">请求详情</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => copyCurl(log)}
              className="text-primary-600 hover:text-primary-700 text-xs flex items-center gap-1"
              title="复制 curl 命令"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              复制 curl
            </button>
            <button
              onClick={() => setSelectedLog(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="space-y-4 text-sm">
            {/* 基本信息 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-gray-500 text-xs">平台</div>
                <div className="font-medium">{getPlatformName(log.platformId)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">状态码</div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(log.responseStatus)}`}>
                  {log.responseStatus}
                </span>
              </div>
              <div>
                <div className="text-gray-500 text-xs">耗时</div>
                <div>{formatDuration(log.duration)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">时间</div>
                <div>{new Date(log.createdAt).toLocaleString()}</div>
              </div>
            </div>

            {/* Token 统计 */}
            {(log.isStream || log.inputTokens || log.outputTokens) && (
              <div className="bg-purple-50 rounded-lg p-3">
                <div className="text-purple-700 text-xs font-medium mb-2">Token 统计</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-purple-500 text-xs">输入 Tokens</div>
                    <div className="font-medium text-purple-700">{log.inputTokens ?? '-'}</div>
                  </div>
                  <div>
                    <div className="text-purple-500 text-xs">输出 Tokens</div>
                    <div className="font-medium text-purple-700">{log.outputTokens ?? '-'}</div>
                  </div>
                  {log.cacheReadInputTokens && (
                    <div>
                      <div className="text-purple-500 text-xs">缓存读取 Tokens</div>
                      <div className="font-medium text-purple-700">{log.cacheReadInputTokens}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-purple-500 text-xs">首 Token 时间</div>
                    <div className="font-medium text-purple-700">{formatFirstTokenTime(log.firstTokenTime)}</div>
                  </div>
                  <div>
                    <div className="text-purple-500 text-xs">输出速度</div>
                    <div className="font-medium text-purple-700">{formatTokenSpeed(log.tokensPerSecond)}</div>
                  </div>
                </div>
              </div>
            )}

            {/* URL */}
            <div>
              <div className="text-gray-500 text-xs mb-1">请求地址</div>
              <div className="bg-gray-900 text-green-400 p-2 rounded font-mono text-xs">
                {log.method} {log.path}
              </div>
              <div className="text-gray-400 text-xs mt-1">{log.baseUrl}</div>
            </div>

            {/* 请求头 */}
            {log.requestHeaders && Object.keys(log.requestHeaders).length > 0 && (
              <div>
                <div className="text-gray-500 text-xs mb-1">请求头</div>
                <div className="bg-gray-100 p-2 rounded font-mono text-xs">
                  {Object.entries(log.requestHeaders).map(([key, value]) => (
                    <div key={key}>
                      <span className="text-purple-600">{key}:</span> {value}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 请求体 */}
            {log.requestBody && (
              <div>
                <div className="text-gray-500 text-xs mb-1">请求体</div>
                <pre className="bg-gray-900 text-gray-300 p-2 rounded font-mono text-xs overflow-auto max-h-40">
                  {formatJson(log.requestBody)}
                </pre>
              </div>
            )}

            {/* 响应体 */}
            {log.responseBody && (
              <div>
                <div className="text-gray-500 text-xs mb-1">响应体</div>
                <pre className="bg-gray-900 text-gray-300 p-2 rounded font-mono text-xs overflow-auto max-h-60">
                  {formatJson(log.responseBody)}
                </pre>
              </div>
            )}

            {/* 汇总内容（流式输出） */}
            {log.isStream && log.streamData && (
              <div>
                <div className="text-gray-500 text-xs mb-1">汇总内容</div>
                <pre className="bg-gray-900 text-gray-300 p-2 rounded font-mono text-xs overflow-auto max-h-60">
                  {formatJson(log.streamData)}
                </pre>
              </div>
            )}

            {/* 错误信息 */}
            {log.error && (
              <div>
                <div className="text-red-500 text-xs mb-1">错误</div>
                <div className="bg-red-50 text-red-600 p-2 rounded text-xs">
                  {log.error}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">调用日志</h1>
          <p className="text-gray-500 mt-1">
            实时监控和历史记录
            {activeRequests.length > 0 && (
              <span className="ml-2 text-yellow-600">
                · {activeRequests.length} 个请求进行中
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('json')}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
          >
            导出 JSON
          </button>
          <button
            onClick={handleClearLogs}
            className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-md hover:bg-red-200"
          >
            清空日志
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <select
          value={filter.platformId}
          onChange={(e) => setFilter({ ...filter, platformId: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="">全部平台</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="">全部状态</option>
          <option value="success">成功 (2xx)</option>
          <option value="error">错误 (4xx/5xx)</option>
        </select>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex gap-4">
        {/* Log List */}
        <div className={`flex-1 overflow-auto space-y-2 ${selectedLog ? 'w-1/2' : 'w-full'}`}>
          {/* Active Requests */}
          {activeRequests
            .filter(r => !filter.platformId || r.platformId === filter.platformId)
            .map(request => renderActiveRequest(request))}

          {/* Divider */}
          {activeRequests.length > 0 && filteredLogs.length > 0 && (
            <div className="flex items-center gap-2 py-2">
              <div className="flex-1 h-px bg-gray-200"></div>
              <span className="text-xs text-gray-400">历史记录</span>
              <div className="flex-1 h-px bg-gray-200"></div>
            </div>
          )}

          {/* History Logs */}
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <span className="text-gray-500">加载中...</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex justify-center items-center h-32">
              <span className="text-gray-500">
                {activeRequests.length > 0 ? '暂无历史记录' : '暂无日志记录'}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLogs.map(log => renderHistoryLog(log))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedLog && renderDetailPanel()}
      </div>
    </div>
  )
}
