import { BrowserWindow } from 'electron'

const MAX_LENGTH = 512
const VALID_ACTIONS = new Set(['channel', 'server'])
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/

export function handleDeepLink(url: string, mainWindow: BrowserWindow | null) {
  if (!mainWindow) return
  if (typeof url !== 'string' || url.length > MAX_LENGTH) return

  mainWindow.show()
  mainWindow.focus()

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'bloumechat:') return

    const action = parsed.hostname
    const id = parsed.pathname.replace(/^\//, '')

    if (!VALID_ACTIONS.has(action)) {
      console.warn('[DeepLink] Unknown action, ignoring:', action)
      return
    }
    if (id && !VALID_ID_REGEX.test(id)) {
      console.warn('[DeepLink] Invalid id format, ignoring deep link')
      return
    }

    const queryParams = Object.fromEntries(
      Array.from(parsed.searchParams.entries())
        .filter(([k, v]) => k.length <= 64 && v.length <= 256)
        .slice(0, 10)
    )
    mainWindow.webContents.send('deep-link', { action, id, queryParams })
  } catch (e) {
    console.error('[DeepLink] Failed to parse:', url)
  }
}
