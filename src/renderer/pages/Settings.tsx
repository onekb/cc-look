import { useEffect, useState } from 'react'
import type { AppSettings, UpdateCheckResult } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const data = await window.api.settings.get()
      setSettings(data)
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      await window.api.settings.set(settings)
      setMessage('设置已保存')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      console.error('Failed to save settings:', error)
      setMessage('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    setUpdateResult(null)
    try {
      const result = await window.api.update.check()
      setUpdateResult(result)
    } catch (error) {
      console.error('Failed to check update:', error)
    } finally {
      setCheckingUpdate(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <span className="text-gray-500">加载中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">设置</h1>
        <p className="text-gray-500 mt-1">配置应用程序行为</p>
      </div>

      {/* Settings Form */}
      <div className="space-y-6">
        {/* Theme */}
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-3">外观</h3>
          <div>
            <label className="block text-sm text-gray-700 mb-2">主题</label>
            <select
              value={settings.theme}
              onChange={(e) => setSettings({ ...settings, theme: e.target.value as AppSettings['theme'] })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
        </div>

        {/* Proxy */}
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-3">代理设置</h3>
          <div>
            <label className="block text-sm text-gray-700 mb-2">代理端口</label>
            <input
              type="number"
              value={settings.proxyPort}
              onChange={(e) => setSettings({ ...settings, proxyPort: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              min={1024}
              max={65535}
            />
            <p className="text-xs text-gray-500 mt-1">
              所有平台共用同一个代理端口，通过 URL 路径前缀区分不同平台
            </p>
          </div>
        </div>

        {/* Logs */}
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-3">日志设置</h3>
          <div>
            <label className="block text-sm text-gray-700 mb-2">日志保留天数</label>
            <input
              type="number"
              value={settings.logRetentionDays}
              onChange={(e) => setSettings({ ...settings, logRetentionDays: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              min={1}
              max={365}
            />
            <p className="text-xs text-gray-500 mt-1">
              超过此天数的日志将被自动清理
            </p>
          </div>
        </div>

        {/* System */}
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-3">系统设置</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.autoStart}
                onChange={(e) => setSettings({ ...settings, autoStart: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">开机自动启动</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.minimizeToTray}
                onChange={(e) => setSettings({ ...settings, minimizeToTray: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">最小化到系统托盘</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.floatingWindow || false}
                onChange={(e) => setSettings({ ...settings, floatingWindow: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <span className="text-sm text-gray-700">启用桌面歌词浮动窗口</span>
                <p className="text-xs text-gray-400 mt-0.5">流式响应时显示半透明浮动窗口，可拖拽</p>
              </div>
            </label>
          </div>
        </div>

        {/* Debug - 浮动窗口测试 */}
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-3">调试工具</h3>
          <button
            onClick={() => window.api.debug.testFloatingWindow()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm"
          >
            测试浮动窗口
          </button>
          <p className="text-xs text-gray-400 mt-2">点击测试浮动窗口效果（无需开启设置）</p>
        </div>

        {/* About */}
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-3">关于</h3>
          <div className="text-sm text-gray-600 space-y-2">
            <p className="font-medium">CC Look v1.0.1</p>
            <p>本地 AI API 代理软件 - 开源免费</p>
            <p>
              <a
                href="https://github.com/onekb/cc-look"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 hover:underline"
              >
                https://github.com/onekb/cc-look
              </a>
            </p>
            <p className="text-gray-400">MIT License © 2025 CC Look Team</p>

            {/* 检查更新 */}
            <div className="pt-3 mt-3 border-t border-gray-100">
              <button
                onClick={handleCheckUpdate}
                disabled={checkingUpdate}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors text-sm"
              >
                {checkingUpdate ? '检查中...' : '检查更新'}
              </button>

              {updateResult && (
                <div className="mt-3">
                  {updateResult.hasUpdate ? (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-green-700 font-medium">
                        发现新版本 v{updateResult.latestVersion}
                      </p>
                      <p className="text-green-600 text-xs mt-1">
                        当前版本: v{updateResult.currentVersion}
                      </p>
                      <a
                        href={updateResult.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-2 text-sm text-green-700 hover:text-green-800 underline"
                      >
                        前往下载 →
                      </a>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">
                      已是最新版本 (v{updateResult.currentVersion})
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {saving ? '保存中...' : '保存设置'}
        </button>
        {message && (
          <span className={`text-sm ${message.includes('失败') ? 'text-red-600' : 'text-green-600'}`}>
            {message}
          </span>
        )}
      </div>
    </div>
  )
}
