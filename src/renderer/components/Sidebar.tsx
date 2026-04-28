import type { ReactNode } from 'react'
import { APP_VERSION } from '@shared/constants'
import iconUrl from '../../../resources/icon.png'

interface SidebarProps {
  currentPage: string
  onNavigate: (page: string) => void
}

interface NavItem {
  id: string
  label: string
  icon: ReactNode
}

const navItems: NavItem[] = [
  {
    id: 'platforms',
    label: '平台管理',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
      </svg>
    )
  },
  {
    id: 'logs',
    label: '调用日志',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )
  },
  {
    id: 'settings',
    label: '设置',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )
  }
]

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <div className="w-60 bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950 dark:from-gray-950 dark:via-gray-950 dark:to-black text-white flex flex-col no-drag">
      {/* Logo */}
      <div className="h-14 flex items-center px-5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
            <img src={iconUrl} alt="CC Look" className="w-7 h-7 rounded-md" />
          </div>
          <div>
            <span className="font-semibold text-[15px] tracking-tight">CC Look</span>
            <span className="text-[10px] text-primary-400 ml-1.5 font-medium">API Proxy</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-5 px-3">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = currentPage === item.id
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium ${
                    isActive
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                >
                  <span className={`p-1 rounded-lg ${isActive ? 'bg-primary-500/20 text-primary-400' : ''}`}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                  {isActive && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-400" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">v{APP_VERSION}</span>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500/80" />
            <span className="text-[11px] text-gray-500">运行中</span>
          </div>
        </div>
      </div>
    </div>
  )
}
