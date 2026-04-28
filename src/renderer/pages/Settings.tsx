import { useEffect, useState } from 'react'
import type { AppSettings, UpdateCheckResult } from '@shared/types'
import { APP_VERSION } from '@shared/constants'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useTheme } from '../hooks/useTheme'

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [logSize, setLogSize] = useState<{ count: number; sizeBytes: number } | null>(null)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    fetchSettings()
    fetchLogSize()
  }, [])

  const fetchLogSize = async () => {
    try {
      const size = await window.api.log.getSize()
      setLogSize(size)
    } catch (error) {
      console.error('Failed to fetch log size:', error)
    }
  }

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

  const handleClearLogs = async () => {
    if (confirm('确定要清空所有日志吗？此操作不可恢复。')) {
      try {
        await window.api.log.clear()
        setMessage('日志已清空')
        fetchLogSize()
        setTimeout(() => setMessage(''), 3000)
      } catch (error) {
        console.error('Failed to clear logs:', error)
        setMessage('清空日志失败')
      }
    }
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            <span className="text-gray-400 text-sm">加载中...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">设置</h1>
        <p className="text-gray-400 mt-1 text-sm">配置应用程序行为</p>
      </div>

      {/* Settings Form */}
      <div className="space-y-4">
        {/* Theme */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700 shadow-card">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-violet-500 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">外观</h3>
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">主题</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as AppSettings['theme'])}
              className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-gray-50 dark:bg-gray-800 focus:bg-white dark:focus:bg-gray-700 dark:text-gray-200"
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
        </div>

        {/* Proxy */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700 shadow-card">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">代理设置</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">代理端口</label>
              <input
                type="number"
                value={settings.proxyPort}
                onChange={(e) => setSettings({ ...settings, proxyPort: parseInt(e.target.value) })}
                className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-gray-50 dark:bg-gray-700 focus:bg-white dark:focus:bg-gray-600 dark:text-gray-200"
                min={1024}
                max={65535}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                所有平台共用同一个代理端口，通过 URL 路径前缀区分不同平台
              </p>
            </div>
            <div className="pt-4 border-t border-gray-50 dark:border-gray-700">
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">请求超时（秒）</label>
              <input
                type="number"
                value={settings.requestTimeout ? settings.requestTimeout / 1000 : 0}
                onChange={(e) => setSettings({ ...settings, requestTimeout: parseInt(e.target.value) * 1000 })}
                className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-gray-50 dark:bg-gray-700 focus:bg-white dark:focus:bg-gray-600 dark:text-gray-200"
                min={0}
                max={3600}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                代理请求的超时时间，0 表示不限时（默认 120 秒）
              </p>
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">服务器超时（秒）</label>
              <input
                type="number"
                value={settings.serverTimeout ? settings.serverTimeout / 1000 : 0}
                onChange={(e) => setSettings({ ...settings, serverTimeout: parseInt(e.target.value) * 1000 })}
                className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-gray-50 dark:bg-gray-700 focus:bg-white dark:focus:bg-gray-600 dark:text-gray-200"
                min={0}
                max={3600}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                服务器连接超时时间，0 表示不限时（默认 120 秒）
              </p>
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">Keep-Alive 超时（秒）</label>
              <input
                type="number"
                value={settings.keepAliveTimeout ? settings.keepAliveTimeout / 1000 : 0}
                onChange={(e) => setSettings({ ...settings, keepAliveTimeout: parseInt(e.target.value) * 1000 })}
                className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-gray-50 dark:bg-gray-700 focus:bg-white dark:focus:bg-gray-600 dark:text-gray-200"
                min={0}
                max={300}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                HTTP Keep-Alive 连接超时时间，0 表示不限时（默认 65 秒）
              </p>
            </div>
          </div>
        </div>

        {/* Logs */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700 shadow-card">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-amber-500 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">日志设置</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">日志保留天数</label>
              <input
                type="number"
                value={settings.logRetentionDays}
                onChange={(e) => setSettings({ ...settings, logRetentionDays: parseInt(e.target.value) })}
                className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-gray-50 dark:bg-gray-700 focus:bg-white dark:focus:bg-gray-600 dark:text-gray-200"
                min={1}
                max={365}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                超过此天数的日志将被自动清理
              </p>
            </div>
            <div className="pt-4 border-t border-gray-50 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">日志存储</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {logSize ? `${logSize.count} 条记录，约 ${formatSize(logSize.sizeBytes)}` : '加载中...'}
                  </p>
                </div>
                <button
                  onClick={handleClearLogs}
                  className="px-3.5 py-1.5 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/50 ring-1 ring-red-200 dark:ring-red-800 font-medium transition-colors"
                >
                  清空日志
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* System */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700 shadow-card">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-500 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">系统设置</h3>
          </div>
          <div className="space-y-3">
            <label className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={settings.autoStart}
                onChange={(e) => setSettings({ ...settings, autoStart: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 dark:bg-gray-700"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">开机自动启动</span>
            </label>
            <label className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={settings.minimizeToTray}
                onChange={(e) => setSettings({ ...settings, minimizeToTray: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 dark:bg-gray-700"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">最小化到系统托盘</span>
            </label>
            <label className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={settings.floatingWindow || false}
                onChange={(e) => setSettings({ ...settings, floatingWindow: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 dark:bg-gray-700"
              />
              <div>
                <span className="text-sm text-gray-700 dark:text-gray-300">启用动态浮动窗口</span>
                <p className="text-xs text-gray-400 mt-0.5">流式响应时显示半透明浮动窗口，可拖拽</p>
              </div>
            </label>
          </div>
        </div>

        {/* About */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700 shadow-card">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-primary-500 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">关于</h3>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2 pl-10">
            <p className="font-semibold text-gray-900 dark:text-gray-100">CC Look v{APP_VERSION}</p>
            <p className="text-gray-400">本地 AI API 代理软件 - 开源免费</p>
            <p>
              <a
                href="https://github.com/onekb/cc-look"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 hover:underline"
              >
                https://github.com/onekb/cc-look
              </a>
            </p>
            <p className="text-gray-300 dark:text-gray-600">MIT License © 2026 CC Look Team</p>

            <div className="pt-4 mt-4 border-t border-gray-50 dark:border-gray-700">
              <button
                onClick={handleCheckUpdate}
                disabled={checkingUpdate}
                className="px-4 py-2.5 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors text-sm font-medium ring-1 ring-gray-200 dark:ring-gray-600"
              >
                {checkingUpdate ? '检查中...' : '检查更新'}
              </button>

              {updateResult && (
                <div className="mt-4">
                  {updateResult.hasUpdate ? (
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl ring-1 ring-emerald-100 dark:ring-emerald-900">
                      <p className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        发现新版本 v{updateResult.latestVersion}
                      </p>
                      <p className="text-emerald-500 dark:text-emerald-500 text-xs mt-1">
                        当前版本: v{updateResult.currentVersion}
                      </p>
                      <a
                        href={updateResult.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-3 text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium hover:underline"
                      >
                        前往下载 →
                      </a>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <p className="text-gray-500 dark:text-gray-400 text-sm">
                        已是最新版本 (v{updateResult.currentVersion})
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="mt-6 flex items-center gap-4 pb-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 active:scale-[0.98] transition-all text-sm font-medium shadow-sm shadow-primary-600/20"
        >
          {saving ? '保存中...' : '保存设置'}
        </button>
        {message && (
          <span className={`text-sm font-medium flex items-center gap-1.5 ${
            message.includes('失败') ? 'text-red-600' : 'text-emerald-600'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${message.includes('失败') ? 'bg-red-500' : 'bg-emerald-500'}`} />
            {message}
          </span>
        )}
      </div>
    </div>
  )
}
