import { isTauri } from './tauri.js'

export interface DeepLinkTarget {
  domain: string
  path: string
}

/** Parse a forumline:// URL into a domain and path */
export function parseDeepLink(url: string): DeepLinkTarget | null {
  try {
    const match = url.match(/^forumline:\/\/forum\/([^/]+)(.*)$/)
    if (!match) return null
    return {
      domain: match[1],
      path: match[2] || '/',
    }
  } catch {
    return null
  }
}

/**
 * Listen for deep link events and invoke the callback with the parsed target.
 * Only active in Tauri desktop context. Returns a cleanup function.
 */
export function setupDeepLinkListener(onDeepLink: (target: DeepLinkTarget) => void): () => void {
  if (!isTauri()) return () => {}

  let unlisten: (() => void) | undefined

  const setup = async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      unlisten = await listen<string[]>('deep-link://new-url', (event) => {
        const urls = event.payload
        for (const url of urls) {
          const target = parseDeepLink(url)
          if (target) {
            onDeepLink(target)
            break
          }
        }
      })
    } catch (err) {
      console.error('[FLD:DeepLink] Failed to set up deep link listener:', err)
    }
  }

  setup()
  return () => unlisten?.()
}
