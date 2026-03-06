import type { Platform } from './types'

export const APP_NAME = 'CC Look'

export const DEFAULT_PLATFORMS: Partial<Platform>[] = [
  {
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com',
    pathPrefix: '/openai'
  },
  {
    name: 'Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    pathPrefix: '/claude'
  }
]

// OpenAI API 路径
export const OPENAI_PATHS = [
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/embeddings',
  '/v1/models'
]

// Anthropic API 路径
export const ANTHROPIC_PATHS = [
  '/v1/messages',
  '/v1/complete'
]

// 流式响应相关
export const STREAM_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive'
}
