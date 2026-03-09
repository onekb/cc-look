import { useEffect, useRef, useState } from 'react'
import { useLogStore, type ActiveRequest } from '../stores/platform'
import type { RequestLog } from '@shared/types'

type DetailTab = 'overview' | 'headers' | 'request' | 'response' | 'stream'
type LogViewMode = 'logs' | 'sessions' | 'analysis'
type FullscreenPreview = {
  title: string
  content: string
  tone?: 'default' | 'blue'
} | null

interface LogSession {
  id: string
  platformId: string
  platformName: string
  method: string
  path: string
  summary: string
  startAt: number
  endAt: number
  requestCount: number
  successCount: number
  errorCount: number
  streamCount: number
  avgDuration: number
  maxDuration: number
  lastStatus: number
  logs: RequestLog[]
}

interface FailurePattern {
  id: string
  label: string
  count: number
}

interface EndpointFailure {
  id: string
  platformName: string
  method: string
  path: string
  totalCount: number
  errorCount: number
  errorRate: number
  avgDuration: number
  lastFailureAt: number
}

const SESSION_GAP_MS = 10 * 60 * 1000

export default function Logs() {
  const {
    platforms,
    logs,
    activeRequests,
    loading,
    fetchPlatforms,
    fetchLogs,
    exportLogs,
    subscribeToStream
  } = useLogStore()

  const [selectedLog, setSelectedLog] = useState<RequestLog | ActiveRequest | null>(null)
  const [selectedType, setSelectedType] = useState<'active' | 'history'>('active')
  const [filter, setFilter] = useState({ platformId: '', status: '' })
  const [expandedActiveRequest, setExpandedActiveRequest] = useState<string | null>(null)
  const [expandedHeaders, setExpandedHeaders] = useState(false)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [viewMode, setViewMode] = useState<LogViewMode>('logs')
  const [fullscreenPreview, setFullscreenPreview] = useState<FullscreenPreview>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchPlatforms()
    fetchLogs()

    const unsubscribe = subscribeToStream()
    return () => unsubscribe()
  }, [fetchPlatforms, fetchLogs, subscribeToStream])

  useEffect(() => {
    if (expandedActiveRequest && logContainerRef.current) {
      const element = logContainerRef.current.querySelector(`#active-${expandedActiveRequest}`)
      if (element) {
        element.scrollTop = element.scrollHeight
      }
    }
  }, [activeRequests, expandedActiveRequest])

  useEffect(() => {
    if (!fullscreenPreview) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullscreenPreview(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fullscreenPreview])

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
    if (status >= 400 && status < 500) return 'text-yellow-700 bg-yellow-100'
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

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      window.alert(`${label} 已复制到剪贴板`)
    } catch (error) {
      console.error(`Failed to copy ${label}:`, error)
      window.alert(`复制${label}失败`)
    }
  }

  const generateCurl = (log: RequestLog): string => {
    const url = `${log.baseUrl}${log.path}`
    let curl = `curl '${url}'`

    if (log.method !== 'GET') {
      curl += ` \\\n  -X ${log.method}`
    }

    if (log.requestHeaders && Object.keys(log.requestHeaders).length > 0) {
      for (const [key, value] of Object.entries(log.requestHeaders)) {
        curl += ` \\\n  -H '${key}: ${value}'`
      }
    }

    if (log.requestBody) {
      const body = log.requestBody.replace(/'/g, "'\\''")
      curl += ` \\\n  -d '${body}'`
    }

    return curl
  }

  const copyCurl = (log: RequestLog) => {
    if (window.confirm('⚠️ 警告：请求包含密钥信息，请勿泄露给他人！\n\n确定要复制吗？')) {
      void copyText(generateCurl(log), 'curl 命令')
    }
  }

  const openFullscreenPreview = (title: string, content: string, tone: 'default' | 'blue' = 'default') => {
    setFullscreenPreview({ title, content, tone })
  }

  const extractSummary = (requestBody?: string) => {
    if (!requestBody) return '无请求摘要'

    try {
      const parsed = JSON.parse(requestBody)

      const normalizeContent = (value: unknown): string => {
        if (typeof value === 'string') return value
        if (Array.isArray(value)) {
          return value
            .map((item) => {
              if (typeof item === 'string') return item
              if (item && typeof item === 'object') {
                const text = (item as { text?: string }).text
                if (typeof text === 'string') return text
              }
              return ''
            })
            .filter(Boolean)
            .join(' ')
        }
        return ''
      }

      if (Array.isArray(parsed.messages)) {
        const latestUserMessage = [...parsed.messages].reverse().find((message) => message?.role === 'user')
        const summary = normalizeContent(latestUserMessage?.content)
        if (summary) return summary.slice(0, 80)
      }

      const directSummary = [parsed.prompt, parsed.input, parsed.query, parsed.content]
        .map(normalizeContent)
        .find(Boolean)

      if (directSummary) return directSummary.slice(0, 80)
    } catch {
      return requestBody.slice(0, 80)
    }

    return '无请求摘要'
  }

  const getFailureLabel = (log: RequestLog) => {
    if (log.error) {
      const message = log.error.toLowerCase()
      if (message.includes('timeout')) return '请求超时'
      if (message.includes('econnrefused') || message.includes('socket') || message.includes('network')) return '网络连接失败'
      return '代理或连接错误'
    }
    if (log.responseStatus === 0) return '连接失败'
    if (log.responseStatus === 429) return '限流 / 配额不足'
    if (log.responseStatus >= 500) return '上游服务错误'
    if (log.responseStatus >= 400) return '请求参数或鉴权失败'
    return '其他异常'
  }

  const filteredLogs = logs.filter((log) => {
    if (filter.status === 'success' && (log.responseStatus < 200 || log.responseStatus >= 300)) return false
    if (filter.status === 'error' && log.responseStatus < 400 && !log.error && log.responseStatus !== 0) return false
    if (filter.platformId && log.platformId !== filter.platformId) return false
    return true
  })

  const sessionsAscending: LogSession[] = []
  const latestSessionByKey = new Map<string, LogSession>()

  const logsAscending = [...filteredLogs].sort((a, b) => a.createdAt - b.createdAt)
  logsAscending.forEach((log) => {
    const sessionKey = `${log.platformId}:${log.method}:${log.path}`
    const previousSession = latestSessionByKey.get(sessionKey)
    const shouldCreateNewSession =
      !previousSession || log.createdAt - previousSession.endAt > SESSION_GAP_MS

    if (shouldCreateNewSession) {
      const nextSession: LogSession = {
        id: `${sessionKey}:${log.createdAt}`,
        platformId: log.platformId,
        platformName: getPlatformName(log.platformId),
        method: log.method,
        path: log.path,
        summary: extractSummary(log.requestBody),
        startAt: log.createdAt,
        endAt: log.createdAt,
        requestCount: 1,
        successCount: log.responseStatus >= 200 && log.responseStatus < 300 ? 1 : 0,
        errorCount: log.responseStatus >= 400 || log.responseStatus === 0 || log.error ? 1 : 0,
        streamCount: log.isStream ? 1 : 0,
        avgDuration: log.duration,
        maxDuration: log.duration,
        lastStatus: log.responseStatus,
        logs: [log]
      }
      sessionsAscending.push(nextSession)
      latestSessionByKey.set(sessionKey, nextSession)
      return
    }

    previousSession.logs.push(log)
    previousSession.endAt = log.createdAt
    previousSession.requestCount += 1
    previousSession.successCount += log.responseStatus >= 200 && log.responseStatus < 300 ? 1 : 0
    previousSession.errorCount += log.responseStatus >= 400 || log.responseStatus === 0 || log.error ? 1 : 0
    previousSession.streamCount += log.isStream ? 1 : 0
    previousSession.avgDuration =
      (previousSession.avgDuration * (previousSession.requestCount - 1) + log.duration) / previousSession.requestCount
    previousSession.maxDuration = Math.max(previousSession.maxDuration, log.duration)
    previousSession.lastStatus = log.responseStatus
    if (previousSession.summary === '无请求摘要' && log.requestBody) {
      previousSession.summary = extractSummary(log.requestBody)
    }
  })

  const sessions = sessionsAscending.sort((a, b) => b.endAt - a.endAt)
  const errorLogs = filteredLogs.filter((log) => log.responseStatus >= 400 || log.responseStatus === 0 || !!log.error)
  const slowLogs = [...filteredLogs]
    .filter((log) => log.duration >= 5000)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 6)

  const failurePatternsMap = new Map<string, FailurePattern>()
  errorLogs.forEach((log) => {
    const label = getFailureLabel(log)
    const existing = failurePatternsMap.get(label)
    if (existing) {
      existing.count += 1
    } else {
      failurePatternsMap.set(label, { id: label, label, count: 1 })
    }
  })
  const failurePatterns = [...failurePatternsMap.values()].sort((a, b) => b.count - a.count)

  const endpointFailureMap = new Map<string, EndpointFailure>()
  filteredLogs.forEach((log) => {
    const key = `${log.platformId}:${log.method}:${log.path}`
    const existing = endpointFailureMap.get(key)
    const isError = log.responseStatus >= 400 || log.responseStatus === 0 || !!log.error
    if (existing) {
      existing.totalCount += 1
      existing.errorCount += isError ? 1 : 0
      existing.avgDuration = ((existing.avgDuration * (existing.totalCount - 1)) + log.duration) / existing.totalCount
      if (isError) {
        existing.lastFailureAt = Math.max(existing.lastFailureAt, log.createdAt)
      }
      return
    }

    endpointFailureMap.set(key, {
      id: key,
      platformName: getPlatformName(log.platformId),
      method: log.method,
      path: log.path,
      totalCount: 1,
      errorCount: isError ? 1 : 0,
      errorRate: 0,
      avgDuration: log.duration,
      lastFailureAt: isError ? log.createdAt : 0
    })
  })

  const unstableEndpoints = [...endpointFailureMap.values()]
    .map((endpoint) => ({
      ...endpoint,
      errorRate: endpoint.totalCount > 0 ? endpoint.errorCount / endpoint.totalCount : 0
    }))
    .filter((endpoint) => endpoint.errorCount > 0)
    .sort((a, b) => {
      if (b.errorRate !== a.errorRate) return b.errorRate - a.errorRate
      return b.errorCount - a.errorCount
    })
    .slice(0, 8)

  const averageDuration =
    filteredLogs.length > 0
      ? filteredLogs.reduce((sum, log) => sum + log.duration, 0) / filteredLogs.length
      : 0
  const errorRate = filteredLogs.length > 0 ? errorLogs.length / filteredLogs.length : 0
  const latestFailure = errorLogs.length > 0 ? errorLogs[0] : null

  const renderActiveRequest = (request: ActiveRequest) => {
    const isExpanded = expandedActiveRequest === request.requestId
    const isSelected =
      selectedLog &&
      selectedType === 'active' &&
      (selectedLog as ActiveRequest).requestId === request.requestId
    const duration = Date.now() - request.startTime

    return (
      <div
        key={request.requestId}
        id={`active-${request.requestId}`}
        className={`overflow-hidden rounded-2xl border bg-white transition-all ${
          request.status === 'error'
            ? 'border-red-200 bg-red-50/40'
            : isSelected
              ? 'border-primary-300 shadow-md'
              : 'border-yellow-200 bg-yellow-50/50'
        }`}
      >
        <div
          className={`flex cursor-pointer items-center justify-between px-4 py-3 ${
            request.status === 'error' ? 'hover:bg-red-50' : 'hover:bg-yellow-50'
          }`}
          onClick={() => {
            setExpandedActiveRequest(isExpanded ? null : request.requestId)
            setSelectedLog(request)
            setSelectedType('active')
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`h-3 w-3 rounded-full ${
                request.status === 'streaming'
                  ? 'bg-green-500 animate-pulse'
                  : request.status === 'error'
                    ? 'bg-red-500'
                    : 'bg-yellow-500 animate-pulse'
              }`}
            />

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{request.platformName}</span>
                <span className="truncate text-xs text-gray-500">
                  {request.method} {request.path}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500">进行中 · {formatDuration(duration)}</div>
            </div>
          </div>

          <div className="ml-3 flex items-center gap-2">
            <button
              onClick={(event) => {
                event.stopPropagation()
                setSelectedLog(request)
                setSelectedType('active')
              }}
              className="rounded-full bg-white/80 px-2.5 py-1 text-xs text-gray-600 hover:bg-white"
            >
              查看详情
            </button>
            <span className="rounded-full bg-yellow-200 px-2 py-0.5 text-xs text-yellow-800">
              {request.rawContent.length} chunks
            </span>
            <svg
              className={`h-5 w-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-yellow-200">
            <div className="flex items-center justify-between bg-yellow-100 px-4 py-2">
              <div className="text-xs font-medium text-yellow-900">实时 SSE 数据</div>
              <button
                onClick={() => void copyText(request.rawContent.join('\n'), '实时原始数据')}
                className="text-xs text-yellow-900/80 hover:text-yellow-950"
              >
                复制内容
              </button>
            </div>
            <div
              ref={logContainerRef}
              className="max-h-64 overflow-auto bg-gray-950 p-3 font-mono text-xs text-gray-300"
            >
              {request.rawContent.length === 0 ? (
                <div className="text-gray-500">等待数据...</div>
              ) : (
                request.rawContent.map((content, index) => (
                  <div key={index} className="mb-2 last:mb-0">
                    <span className="text-gray-500">{index + 1}:</span>{' '}
                    <span className="break-words text-green-400">{content}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderHistoryLog = (log: RequestLog) => {
    const isSelected = selectedLog && selectedType === 'history' && (selectedLog as RequestLog).id === log.id

    return (
      <div
        key={log.id}
        onClick={() => {
          setSelectedLog(log)
          setSelectedType('history')
          setExpandedHeaders(false)
          setDetailTab('overview')
        }}
        className={`cursor-pointer rounded-2xl border bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md ${
          isSelected ? 'border-primary-400 shadow-md ring-2 ring-primary-100' : 'border-gray-200'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`status-dot ${
                log.responseStatus >= 200 && log.responseStatus < 300 ? 'running' : 'stopped'
              }`}
            />

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{getPlatformName(log.platformId)}</span>
                <span className="truncate text-xs text-gray-500">
                  {log.method} {log.path}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {new Date(log.createdAt).toLocaleString()} · {formatDuration(log.duration)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {(log.inputTokens || log.outputTokens) && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700" title="输入/输出 tokens">
                {log.inputTokens || 0}/{log.outputTokens || 0}
              </span>
            )}
            {log.firstTokenTime && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700" title="首 Token 时间">
                TTFT: {formatFirstTokenTime(log.firstTokenTime)}
              </span>
            )}
            {log.tokensPerSecond && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700" title="输出速度">
                {formatTokenSpeed(log.tokensPerSecond)}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(log.responseStatus)}`}>
              {log.responseStatus}
            </span>
            {log.isStream && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">Stream</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderSessionCard = (session: LogSession) => {
    const isExpanded = expandedSessionId === session.id
    const latestLog = session.logs[session.logs.length - 1]

    return (
      <div key={session.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div
          className="cursor-pointer px-4 py-4 transition-colors hover:bg-gray-50"
          onClick={() => setExpandedSessionId(isExpanded ? null : session.id)}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{session.platformName}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">
                  {session.method} {session.path}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(session.lastStatus)}`}>
                  最近状态 {session.lastStatus}
                </span>
              </div>
              <div className="mt-2 text-sm text-gray-600">{session.summary}</div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                <span>{new Date(session.startAt).toLocaleString()} - {new Date(session.endAt).toLocaleTimeString()}</span>
                <span>{session.requestCount} 次请求</span>
                <span>{session.errorCount} 次失败</span>
                <span>平均耗时 {formatDuration(session.avgDuration)}</span>
                <span>最长 {formatDuration(session.maxDuration)}</span>
                <span>{session.streamCount} 次流式响应</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  setSelectedLog(latestLog)
                  setSelectedType('history')
                  setDetailTab('overview')
                }}
                className="rounded-xl border border-primary-200 px-3 py-1.5 text-xs text-primary-700 hover:bg-primary-50"
              >
                查看最近请求
              </button>
              <svg
                className={`h-5 w-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-3">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">会话时间线</div>
            <div className="space-y-2">
              {[...session.logs].reverse().map((log) => (
                <button
                  key={log.id}
                  onClick={() => {
                    setSelectedLog(log)
                    setSelectedType('history')
                    setDetailTab('overview')
                  }}
                  className="flex w-full items-start justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 text-left hover:border-primary-200 hover:bg-primary-50/30"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(log.responseStatus)}`}>
                        {log.responseStatus}
                      </span>
                      <span className="text-sm text-gray-800">{new Date(log.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-gray-500">
                      {extractSummary(log.requestBody)}
                    </div>
                  </div>
                  <div className="ml-4 text-xs text-gray-500">
                    {formatDuration(log.duration)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderAnalysisPanel = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">筛选后总请求</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{filteredLogs.length}</div>
        </div>
        <div className="rounded-2xl border border-red-100 bg-red-50 p-4 shadow-sm">
          <div className="text-xs text-red-500">失败率</div>
          <div className="mt-2 text-2xl font-semibold text-red-700">{(errorRate * 100).toFixed(1)}%</div>
          <div className="mt-1 text-xs text-red-600">{errorLogs.length} 次失败</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">平均耗时</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{formatDuration(averageDuration)}</div>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
          <div className="text-xs text-amber-600">最近失败</div>
          <div className="mt-2 text-sm font-semibold text-amber-900">
            {latestFailure ? `${getPlatformName(latestFailure.platformId)} ${latestFailure.method} ${latestFailure.path}` : '暂无'}
          </div>
          <div className="mt-1 text-xs text-amber-700">
            {latestFailure ? new Date(latestFailure.createdAt).toLocaleString() : '当前筛选下没有失败'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900">失败模式</div>
              <div className="mt-1 text-xs text-gray-500">按错误类型归类，快速识别主要问题来源。</div>
            </div>
          </div>
          {failurePatterns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
              当前筛选下没有失败请求
            </div>
          ) : (
            <div className="space-y-3">
              {failurePatterns.map((pattern) => (
                <div key={pattern.id} className="rounded-xl border border-gray-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-medium text-gray-800">{pattern.label}</div>
                    <div className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{pattern.count}</div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-red-400"
                      style={{ width: `${errorLogs.length > 0 ? (pattern.count / errorLogs.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="font-medium text-gray-900">慢请求 Top 6</div>
          <div className="mt-1 text-xs text-gray-500">优先检查超过 5 秒的请求。</div>
          {slowLogs.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
              当前筛选下没有慢请求
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {slowLogs.map((log) => (
                <button
                  key={log.id}
                  onClick={() => {
                    setSelectedLog(log)
                    setSelectedType('history')
                    setDetailTab('overview')
                  }}
                  className="flex w-full items-start justify-between rounded-xl border border-gray-200 px-3 py-3 text-left hover:border-primary-200 hover:bg-primary-50/30"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{getPlatformName(log.platformId)}</span>
                      <span className="truncate text-xs text-gray-500">{log.method} {log.path}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{new Date(log.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="ml-4 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {formatDuration(log.duration)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="font-medium text-gray-900">不稳定接口</div>
        <div className="mt-1 text-xs text-gray-500">按错误率和失败次数排序，定位最值得优先处理的接口。</div>
        {unstableEndpoints.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            当前筛选下没有可分析的失败接口
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200">
            <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_1fr] gap-3 bg-gray-50 px-4 py-3 text-xs font-medium text-gray-500">
              <div>接口</div>
              <div>错误率</div>
              <div>失败次数</div>
              <div>平均耗时</div>
              <div>最近失败</div>
            </div>
            {unstableEndpoints.map((endpoint) => (
              <div key={endpoint.id} className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_1fr] gap-3 border-t border-gray-100 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900">{endpoint.platformName}</div>
                  <div className="truncate font-mono text-xs text-gray-500">{endpoint.method} {endpoint.path}</div>
                </div>
                <div className="text-red-600">{(endpoint.errorRate * 100).toFixed(1)}%</div>
                <div className="text-gray-700">{endpoint.errorCount}/{endpoint.totalCount}</div>
                <div className="text-gray-700">{formatDuration(endpoint.avgDuration)}</div>
                <div className="text-xs text-gray-500">
                  {endpoint.lastFailureAt ? new Date(endpoint.lastFailureAt).toLocaleString() : '-'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="font-medium text-gray-900">最近失败请求</div>
        <div className="mt-1 text-xs text-gray-500">点击条目可继续查看请求详情。</div>
        {errorLogs.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            当前筛选下没有失败请求
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {errorLogs.slice(0, 8).map((log) => (
              <button
                key={log.id}
                onClick={() => {
                  setSelectedLog(log)
                  setSelectedType('history')
                  setDetailTab('overview')
                }}
                className="flex w-full items-start justify-between rounded-xl border border-gray-200 px-3 py-3 text-left hover:border-primary-200 hover:bg-primary-50/30"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(log.responseStatus)}`}>
                      {log.responseStatus || 'ERR'}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{getPlatformName(log.platformId)}</span>
                    <span className="truncate text-xs text-gray-500">{log.method} {log.path}</span>
                  </div>
                  <div className="mt-1 text-xs text-red-600">{getFailureLabel(log)}</div>
                  <div className="mt-1 text-xs text-gray-500">{new Date(log.createdAt).toLocaleString()}</div>
                </div>
                <div className="ml-4 text-xs text-gray-500">{formatDuration(log.duration)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  const renderDetailPanel = () => {
    if (!selectedLog) return null

    if (selectedType === 'active') {
      const request = selectedLog as ActiveRequest

      return (
        <div className="flex w-[36rem] max-w-[48vw] min-w-[28rem] flex-col overflow-hidden rounded-3xl border border-yellow-200 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-3 border-b border-yellow-200 bg-gradient-to-r from-yellow-50 to-amber-50 px-5 py-4">
            <div>
              <div className="font-medium text-gray-900">实时请求详情</div>
              <div className="mt-1 text-xs text-yellow-800">侧重观察流式片段，便于调试 SSE 返回顺序。</div>
            </div>
            <button onClick={() => setSelectedLog(null)} className="text-gray-400 hover:text-gray-600">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 border-b border-gray-100 p-5 text-sm">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs text-gray-500">平台</div>
              <div className="mt-1 font-medium">{request.platformName}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs text-gray-500">持续时间</div>
              <div className="mt-1 font-medium">{formatDuration(Date.now() - request.startTime)}</div>
            </div>
            <div className="col-span-2 rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs text-gray-500">路径</div>
              <div className="mt-1 break-all font-mono text-xs">
                {request.method} {request.path}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <div className="text-sm font-medium text-gray-900">原始数据 ({request.rawContent.length} 条)</div>
            <button
              onClick={() => void copyText(request.rawContent.join('\n'), '实时原始数据')}
              className="text-xs text-primary-600 hover:text-primary-700"
            >
              复制内容
            </button>
          </div>

          <div className="flex-1 overflow-auto p-5">
            <div className="overflow-hidden rounded-2xl border border-gray-200">
              <div className="max-h-[32rem] overflow-auto bg-gray-950 p-4 font-mono text-xs text-gray-200">
                {request.rawContent.length === 0 ? (
                  <div className="text-gray-500">等待数据...</div>
                ) : (
                  request.rawContent.map((content, index) => (
                    <div key={index} className="mb-2 last:mb-0">
                      <span className="text-gray-500">[{index + 1}]</span> {content}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )
    }

    const log = selectedLog as RequestLog
    const requestHeaders = log.requestHeaders ? Object.entries(log.requestHeaders) : []
    const tabItems: Array<{ key: DetailTab; label: string; count?: number; disabled?: boolean }> = [
      { key: 'overview', label: '概览' },
      { key: 'headers', label: '请求头', count: requestHeaders.length, disabled: requestHeaders.length === 0 },
      { key: 'request', label: '请求体', disabled: !log.requestBody },
      { key: 'response', label: '响应体', disabled: !log.responseBody },
      { key: 'stream', label: '流式汇总', disabled: !log.streamData }
    ]

    return (
      <div className="flex w-[48rem] max-w-[58vw] min-w-[34rem] flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 bg-gradient-to-r from-white to-gray-50 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">请求详情</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(log.responseStatus)}`}>
                {log.responseStatus}
              </span>
              {log.isStream && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">Stream</span>}
            </div>
            <div className="mt-1 break-all font-mono text-xs text-gray-500">
              {log.method} {log.baseUrl}{log.path}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => copyCurl(log)}
              className="flex items-center gap-1 rounded-xl border border-primary-200 px-3 py-1.5 text-xs text-primary-700 hover:bg-primary-50"
              title="复制 curl 命令"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              复制 curl
            </button>
            <button onClick={() => setSelectedLog(null)} className="text-gray-400 hover:text-gray-600">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="border-b border-gray-100 px-5 py-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="text-xs text-gray-500">平台</div>
              <div className="mt-1 font-medium">{getPlatformName(log.platformId)}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="text-xs text-gray-500">耗时</div>
              <div className="mt-1 font-medium">{formatDuration(log.duration)}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="text-xs text-gray-500">时间</div>
              <div className="mt-1 text-xs font-medium">{new Date(log.createdAt).toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="text-xs text-gray-500">请求头</div>
              <div className="mt-1 font-medium">{requestHeaders.length}</div>
            </div>
          </div>

          {(log.isStream || log.inputTokens || log.outputTokens || log.cacheReadInputTokens) && (
            <div className="mt-3 rounded-2xl border border-purple-100 bg-purple-50 p-3">
              <div className="mb-2 text-xs font-medium text-purple-700">Token 统计</div>
              <div className="grid grid-cols-2 gap-3 text-sm xl:grid-cols-5">
                <div>
                  <div className="text-xs text-purple-500">输入</div>
                  <div className="mt-1 font-medium text-purple-700">{log.inputTokens ?? '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-purple-500">输出</div>
                  <div className="mt-1 font-medium text-purple-700">{log.outputTokens ?? '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-purple-500">缓存读取</div>
                  <div className="mt-1 font-medium text-purple-700">{log.cacheReadInputTokens ?? '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-purple-500">首 Token</div>
                  <div className="mt-1 font-medium text-purple-700">{formatFirstTokenTime(log.firstTokenTime)}</div>
                </div>
                <div>
                  <div className="text-xs text-purple-500">输出速度</div>
                  <div className="mt-1 font-medium text-purple-700">{formatTokenSpeed(log.tokensPerSecond)}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-b border-gray-100 px-5 pt-3">
          <div className="flex gap-2 overflow-x-auto pb-3">
            {tabItems.map((tab) => (
              <button
                key={tab.key}
                onClick={() => !tab.disabled && setDetailTab(tab.key)}
                disabled={tab.disabled}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  detailTab === tab.key
                    ? 'bg-primary-600 text-white'
                    : tab.disabled
                      ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab.label}
                {typeof tab.count === 'number' ? ` (${tab.count})` : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {detailTab === 'overview' && (
            <div className="space-y-4 text-sm">
              <div className="overflow-hidden rounded-2xl border border-gray-200">
                <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">
                  请求地址
                </div>
                <div className="break-all bg-gray-950 p-3 font-mono text-xs text-green-400">
                  {log.method} {log.baseUrl}{log.path}
                </div>
              </div>

              {log.error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
                  <div className="mb-1 text-xs font-medium text-red-600">错误信息</div>
                  <div className="whitespace-pre-wrap break-words text-sm text-red-700">{log.error}</div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="overflow-hidden rounded-2xl border border-gray-200">
                  <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="text-xs font-medium text-gray-700">请求体预览</div>
                    <div className="flex items-center gap-3">
                      {log.requestBody && (
                        <>
                          <button
                            onClick={() => openFullscreenPreview('请求体预览', formatJson(log.requestBody))}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            全屏预览
                          </button>
                          <button
                            onClick={() => void copyText(log.requestBody, '请求体')}
                            className="text-xs text-primary-600 hover:text-primary-700"
                          >
                            复制
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {log.requestBody ? (
                    <pre className="max-h-[18rem] overflow-auto bg-gray-950 p-3 font-mono text-xs text-gray-200">
                      {formatJson(log.requestBody)}
                    </pre>
                  ) : (
                    <div className="p-3 text-xs text-gray-400">无请求体</div>
                  )}
                </div>

                <div className="overflow-hidden rounded-2xl border border-gray-200">
                  <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="text-xs font-medium text-gray-700">响应体预览</div>
                    <div className="flex items-center gap-3">
                      {log.responseBody && (
                        <>
                          <button
                            onClick={() => openFullscreenPreview('响应体预览', formatJson(log.responseBody))}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            全屏预览
                          </button>
                          <button
                            onClick={() => void copyText(log.responseBody, '响应体')}
                            className="text-xs text-primary-600 hover:text-primary-700"
                          >
                            复制
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {log.responseBody ? (
                    <pre className="max-h-[18rem] overflow-auto bg-gray-950 p-3 font-mono text-xs text-gray-200">
                      {formatJson(log.responseBody)}
                    </pre>
                  ) : (
                    <div className="p-3 text-xs text-gray-400">无响应体</div>
                  )}
                </div>
              </div>

              {log.streamData && (
                <div className="overflow-hidden rounded-2xl border border-blue-100">
                  <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-3 py-2">
                    <div className="text-xs font-medium text-blue-700">流式汇总</div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => openFullscreenPreview('流式汇总', formatJson(log.streamData || ''), 'blue')}
                        className="text-xs text-blue-500 hover:text-blue-700"
                      >
                        全屏预览
                      </button>
                      <button
                        onClick={() => void copyText(log.streamData || '', '流式汇总')}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        复制
                      </button>
                    </div>
                  </div>
                  <pre className="max-h-[18rem] overflow-auto bg-slate-950 p-3 font-mono text-xs text-gray-200">
                    {formatJson(log.streamData)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {detailTab === 'headers' && (
            <div className="overflow-hidden rounded-2xl border border-gray-200">
              <div
                className="flex cursor-pointer items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2"
                onClick={() => setExpandedHeaders(!expandedHeaders)}
              >
                <div className="text-xs font-medium text-gray-700">请求头列表</div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      void copyText(
                        requestHeaders.map(([key, value]) => `${key}: ${value}`).join('\n'),
                        '请求头'
                      )
                    }}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    复制
                  </button>
                  <svg
                    className={`h-4 w-4 text-gray-400 transition-transform ${expandedHeaders ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              {expandedHeaders ? (
                <div className="divide-y divide-gray-100">
                  {requestHeaders.map(([key, value]) => (
                    <div key={key} className="px-3 py-2 text-sm">
                      <div className="font-mono text-xs text-purple-600">{key}</div>
                      <div className="mt-1 break-all text-gray-700">{value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-xs text-gray-400">点击标题栏展开请求头</div>
              )}
            </div>
          )}

          {detailTab === 'request' && log.requestBody && (
            <div className="overflow-hidden rounded-2xl border border-gray-200">
              <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-xs font-medium text-gray-700">请求体</div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => openFullscreenPreview('请求体', formatJson(log.requestBody || ''))}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    全屏预览
                  </button>
                  <button
                    onClick={() => void copyText(log.requestBody || '', '请求体')}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    复制
                  </button>
                </div>
              </div>
              <pre className="min-h-[22rem] overflow-auto bg-gray-950 p-4 font-mono text-xs text-gray-200">
                {formatJson(log.requestBody)}
              </pre>
            </div>
          )}

          {detailTab === 'response' && log.responseBody && (
            <div className="overflow-hidden rounded-2xl border border-gray-200">
              <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-xs font-medium text-gray-700">响应体</div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => openFullscreenPreview('响应体', formatJson(log.responseBody || ''))}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    全屏预览
                  </button>
                  <button
                    onClick={() => void copyText(log.responseBody || '', '响应体')}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    复制
                  </button>
                </div>
              </div>
              <pre className="min-h-[22rem] overflow-auto bg-gray-950 p-4 font-mono text-xs text-gray-200">
                {formatJson(log.responseBody)}
              </pre>
            </div>
          )}

          {detailTab === 'stream' && log.streamData && (
            <div className="overflow-hidden rounded-2xl border border-blue-100">
              <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-3 py-2">
                <div className="text-xs font-medium text-blue-700">流式汇总</div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => openFullscreenPreview('流式汇总', formatJson(log.streamData || ''), 'blue')}
                    className="text-xs text-blue-500 hover:text-blue-700"
                  >
                    全屏预览
                  </button>
                  <button
                    onClick={() => void copyText(log.streamData || '', '流式汇总')}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    复制
                  </button>
                </div>
              </div>
              <pre className="min-h-[22rem] overflow-auto bg-slate-950 p-4 font-mono text-xs text-gray-200">
                {formatJson(log.streamData)}
              </pre>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderMainContent = () => {
    if (loading) {
      return (
        <div className="flex h-32 items-center justify-center">
          <span className="text-gray-500">加载中...</span>
        </div>
      )
    }

    if (viewMode === 'logs') {
      return (
        <>
          {activeRequests
            .filter(r => !filter.platformId || r.platformId === filter.platformId)
            .map(request => renderActiveRequest(request))}

          {activeRequests.length > 0 && filteredLogs.length > 0 && (
            <div className="flex items-center gap-2 py-2">
              <div className="h-px flex-1 bg-gray-200"></div>
              <span className="text-xs text-gray-400">历史记录</span>
              <div className="h-px flex-1 bg-gray-200"></div>
            </div>
          )}

          {filteredLogs.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
              <span className="text-gray-500">
                {activeRequests.length > 0 ? '暂无历史记录' : '暂无日志记录'}
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLogs.map(log => renderHistoryLog(log))}
            </div>
          )}
        </>
      )
    }

    if (viewMode === 'sessions') {
      return sessions.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
          <span className="text-gray-500">当前筛选下没有可聚合的会话</span>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(session => renderSessionCard(session))}
        </div>
      )
    }

    return renderAnalysisPanel()
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">调用日志</h1>
          <p className="mt-1 text-gray-500">
            实时监控、会话聚合和失败分析
            {activeRequests.length > 0 && (
              <span className="ml-2 text-yellow-600">· {activeRequests.length} 个请求进行中</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('json')}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200"
          >
            导出 JSON
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex rounded-full border border-gray-200 bg-white p-1 shadow-sm">
          {[
            { key: 'logs' as const, label: '历史记录' },
            { key: 'sessions' as const, label: '会话视图' },
            { key: 'analysis' as const, label: '失败分析' }
          ].map((mode) => (
            <button
              key={mode.key}
              onClick={() => setViewMode(mode.key)}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                viewMode === mode.key
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <select
          value={filter.platformId}
          onChange={(e) => setFilter({ ...filter, platformId: e.target.value })}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">全部平台</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">全部状态</option>
          <option value="success">成功 (2xx)</option>
          <option value="error">错误 (4xx/5xx)</option>
        </select>
      </div>

      {viewMode !== 'logs' && (
        <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-4">
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs text-gray-500">历史日志数</div>
            <div className="mt-1 text-xl font-semibold text-gray-900">{filteredLogs.length}</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs text-gray-500">聚合会话数</div>
            <div className="mt-1 text-xl font-semibold text-gray-900">{sessions.length}</div>
          </div>
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 shadow-sm">
            <div className="text-xs text-red-500">失败请求数</div>
            <div className="mt-1 text-xl font-semibold text-red-700">{errorLogs.length}</div>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 shadow-sm">
            <div className="text-xs text-amber-600">平均耗时</div>
            <div className="mt-1 text-xl font-semibold text-amber-900">{formatDuration(averageDuration)}</div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 gap-4 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-auto space-y-3">
          {renderMainContent()}
        </div>

        {selectedLog && renderDetailPanel()}
      </div>

      {fullscreenPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm">
          <div className="flex h-full max-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-2xl">
            <div
              className={`flex items-center justify-between border-b px-5 py-4 ${
                fullscreenPreview.tone === 'blue'
                  ? 'border-blue-100 bg-blue-50'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="min-w-0">
                <div className="font-medium text-gray-900">{fullscreenPreview.title}</div>
                <div className="mt-1 text-xs text-gray-500">全屏模式下更适合检查长文本、长 JSON 和流式汇总。</div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void copyText(fullscreenPreview.content, fullscreenPreview.title)}
                  className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-white"
                >
                  复制内容
                </button>
                <button
                  onClick={() => setFullscreenPreview(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-950 p-5">
              <pre className="min-h-full whitespace-pre-wrap break-words font-mono text-xs leading-6 text-gray-100">
                {fullscreenPreview.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
