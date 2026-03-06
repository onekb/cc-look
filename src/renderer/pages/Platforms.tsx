import { useEffect, useState } from 'react'
import { usePlatformStore } from '../stores/platform'
import type { Platform, ProtocolType } from '@shared/types'

interface PlatformFormData {
  name: string
  protocol: ProtocolType
  baseUrl: string
  pathPrefix: string
}

const initialFormData: PlatformFormData = {
  name: '',
  protocol: 'openai',
  baseUrl: 'https://api.openai.com',
  pathPrefix: '/openai'
}

export default function Platforms() {
  const { platforms, loading, fetchPlatforms, createPlatform, deletePlatform, startProxy, stopProxy, proxyStatuses } = usePlatformStore()
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState<PlatformFormData>(initialFormData)
  const [editingPlatform, setEditingPlatform] = useState<Platform | null>(null)

  useEffect(() => {
    fetchPlatforms()
  }, [fetchPlatforms])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // 确保路径前缀以 / 开头
    const pathPrefix = formData.pathPrefix.startsWith('/') ? formData.pathPrefix : `/${formData.pathPrefix}`

    if (editingPlatform) {
      // 更新平台
      await usePlatformStore.getState().updatePlatform(editingPlatform.id, { ...formData, pathPrefix })
    } else {
      // 创建平台
      await createPlatform({
        ...formData,
        pathPrefix,
        enabled: true
      })
    }

    setShowModal(false)
    setFormData(initialFormData)
    setEditingPlatform(null)
  }

  const handleEdit = (platform: Platform) => {
    setEditingPlatform(platform)
    setFormData({
      name: platform.name,
      protocol: platform.protocol,
      baseUrl: platform.baseUrl,
      pathPrefix: platform.pathPrefix
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    if (confirm('确定要删除这个平台吗？')) {
      await deletePlatform(id)
    }
  }

  const handleToggleProxy = async (platform: Platform) => {
    const status = proxyStatuses.get(platform.id)
    if (status?.status === 'running') {
      await stopProxy(platform.id)
    } else {
      await startProxy(platform.id)
    }
  }

  const getProtocolLabel = (protocol: ProtocolType) => {
    return protocol === 'openai' ? 'OpenAI' : 'Anthropic'
  }

  const getDefaultPathPrefix = (protocol: ProtocolType) => {
    return protocol === 'openai' ? '/openai' : '/claude'
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">平台管理</h1>
          <p className="text-gray-500 mt-1">管理 AI API 平台配置</p>
        </div>
        <button
          onClick={() => {
            setEditingPlatform(null)
            setFormData(initialFormData)
            setShowModal(true)
          }}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          添加平台
        </button>
      </div>

      {/* Platform List */}
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-500">加载中...</div>
        </div>
      ) : platforms.length === 0 ? (
        <div className="bg-white rounded-lg p-12 text-center">
          <div className="text-gray-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">还没有添加平台</h3>
          <p className="text-gray-500 mb-4">点击上方按钮添加一个 AI API 平台</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {platforms.map((platform) => {
            const proxyStatus = proxyStatuses.get(platform.id)
            const isRunning = proxyStatus?.status === 'running'

            return (
              <div
                key={platform.id}
                className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Status Indicator */}
                    <div className="flex flex-col items-center">
                      <span className={`status-dot ${isRunning ? 'running' : 'stopped'}`}></span>
                      <span className="text-xs text-gray-500 mt-1">
                        {isRunning ? '运行中' : '已停止'}
                      </span>
                    </div>

                    {/* Platform Info */}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{platform.name}</h3>
                        <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                          {getProtocolLabel(platform.protocol)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        <span className="font-mono">{proxyStatus?.localUrl || `http://localhost:3100${platform.pathPrefix}`}</span>
                        <span className="mx-2">→</span>
                        <span className="font-mono">{platform.baseUrl}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleProxy(platform)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        isRunning
                          ? 'bg-red-100 text-red-700 hover:bg-red-200'
                          : 'bg-green-100 text-green-700 hover:bg-green-200'
                      }`}
                    >
                      {isRunning ? '停止' : '启动'}
                    </button>
                    <button
                      onClick={() => handleEdit(platform)}
                      className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(platform.id)}
                      className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {/* Local URL Copy & Usage Example */}
                {isRunning && (
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                    {/* API 地址 */}
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">本地 API 地址:</span>
                      <code className="px-2 py-1 bg-gray-100 rounded text-primary-600 font-mono text-xs">
                        {proxyStatus?.localUrl}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(proxyStatus?.localUrl || '')
                        }}
                        className="text-gray-400 hover:text-gray-600"
                        title="复制地址"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>

                    {/* 使用示例 */}
                    <div className="bg-gray-900 rounded-md p-3 text-xs font-mono text-gray-300 overflow-x-auto">
                      <div className="text-gray-500 mb-2"># curl 示例</div>
                      <pre className="whitespace-pre-wrap break-all">
{platform.protocol === 'openai' ? `curl ${proxyStatus?.localUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'` : `curl ${proxyStatus?.localUrl}/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello, Claude"}]
  }'`}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingPlatform ? '编辑平台' : '添加平台'}
            </h2>

            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    平台名称
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="例如: OpenAI"
                    required
                  />
                </div>

                {/* Protocol */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    协议类型
                  </label>
                  <select
                    value={formData.protocol}
                    onChange={(e) => {
                      const protocol = e.target.value as ProtocolType
                      setFormData({
                        ...formData,
                        protocol,
                        baseUrl: protocol === 'openai'
                          ? 'https://api.openai.com'
                          : 'https://api.anthropic.com',
                        pathPrefix: getDefaultPathPrefix(protocol)
                      })
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                  </select>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    API Base URL
                  </label>
                  <input
                    type="url"
                    value={formData.baseUrl}
                    onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    placeholder="https://api.openai.com"
                    required
                  />
                </div>

                {/* Path Prefix */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    路径前缀
                  </label>
                  <input
                    type="text"
                    value={formData.pathPrefix}
                    onChange={(e) => setFormData({ ...formData, pathPrefix: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    placeholder="/openai"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    用于区分不同平台的 URL 前缀，例如 <code>/openai</code> 或 <code>/claude</code>
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingPlatform(null)
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
                >
                  {editingPlatform ? '保存' : '添加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
