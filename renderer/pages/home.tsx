import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import Head from 'next/head'

const translations = {
  fr: {
    loading: 'Chargement de BloumeChat...',
    back: 'Précédent',
    forward: 'Suivant',
  },
  en: {
    loading: 'Loading BloumeChat...',
    back: 'Back',
    forward: 'Forward',
  },
} as const

type Lang = keyof typeof translations

function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'fr'
  const lang = navigator.language?.toLowerCase() || ''
  if (lang.startsWith('fr')) return 'fr'
  return 'en'
}

export default function HomePage() {
  const [siteUrl, setSiteUrl] = useState('')
  const [platform, setPlatform] = useState<string>('win32')
  const [isReady, setIsReady] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const readySetRef = useRef(false)
  const t = useMemo(() => translations[detectLang()], [])

  const markReady = useCallback(() => {
    if (readySetRef.current) return
    readySetRef.current = true
    setIsReady(true)
  }, [])

  // --- Apply system theme immediately on mount ---
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Detect system dark mode preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')

    const applySystemTheme = () => {
      if (prefersDark.matches) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }

    // Apply immediately
    applySystemTheme()

    // Listen for system theme changes (user switches Windows dark/light mode)
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      // Only update if no iframe theme override has been received
      applySystemTheme()
    }
    prefersDark.addEventListener('change', handleSystemThemeChange)

    return () => {
      prefersDark.removeEventListener('change', handleSystemThemeChange)
    }
  }, [])

  // Fallback: show app after 8s even if iframe never fires load or APP_READY
  useEffect(() => {
    if (!siteUrl) return
    const fallback = setTimeout(markReady, 8000)
    return () => clearTimeout(fallback)
  }, [siteUrl, markReady])

  useEffect(() => {
    const fetchEnv = async () => {
      // @ts-ignore
      const baseUrl = await window.ipc.getEnv('NEXT_PUBLIC_SITE_URL') || 'https://bloumechat.com'
      setSiteUrl(`${baseUrl}/app?platform=desktop`)

      // @ts-ignore
      const p = await window.ipc.getPlatform?.() || 'win32'
      setPlatform(p)
    }
    fetchEnv()

    // Listen for theme changes from the iframe (Bloumechat main site)
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'APP_READY') {
        markReady()
      } else if (event.data?.type === 'THEME_CHANGED') {
        const theme = event.data.theme
        if (theme === 'dark') {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
      } else if (event.data?.type === 'SHOW_NOTIFICATION') {
        // @ts-ignore
        window.ipc.showNotification(event.data.notification)
      } else if (event.data?.type === 'SET_BADGE_COUNT') {
        // @ts-ignore
        window.ipc.setBadgeCount(event.data.count ?? 0)
      } else if (event.data?.type === 'SET_VOICE_ACTIVE') {
        // @ts-ignore
        window.ipc.setVoiceActive(event.data.active === true)
      } else if (event.data?.type === 'IPC_INVOKE') {
        const { id, method, args } = event.data;
        const ipc = (window as any).ipc;
        
        // Convert dash-case from webapp to camelCase used in desktop app
        const methodMap: Record<string, string> = {
          'get-auto-launch': 'getAutoLaunch',
          'set-auto-launch': 'setAutoLaunch',
          'get-minimize-to-tray': 'getMinimizeToTray',
          'set-minimize-to-tray': 'setMinimizeToTray',
          'get-zoom-level': 'getZoomLevel',
          'set-zoom-level': 'setZoomLevel',
          'write-to-clipboard': 'writeToClipboard',
          'get-rpc-enabled': 'getRpcEnabled',
          'set-rpc-enabled': 'setRpcEnabled',
          'get-rpc-show-using': 'getRpcShowUsing',
          'set-rpc-show-using': 'setRpcShowUsing',
          'get-rpc-show-browsing': 'getRpcShowBrowsing',
          'set-rpc-show-browsing': 'setRpcShowBrowsing',
          'get-rpc-show-listening': 'getRpcShowListening',
          'set-rpc-show-listening': 'setRpcShowListening',
          'get-rpc-show-playing': 'getRpcShowPlaying',
          'set-rpc-show-playing': 'setRpcShowPlaying',
        };

        const targetMethod = methodMap[method] || method;

        if (ipc && typeof ipc[targetMethod] === 'function') {
          Promise.resolve(ipc[targetMethod](...args))
            .then(result => {
              if (iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.postMessage({ type: 'IPC_RESPONSE', id, result }, '*');
              }
            })
            .catch(error => {
              if (iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.postMessage({ type: 'IPC_RESPONSE', id, error: error.message }, '*');
              }
            });
        }
      }
    }

    window.addEventListener('message', handleMessage)

    const unsubNotif = window.ipc.onNotificationClick((data: any) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'NAVIGATE',
          channelPublicId: data.channelPublicId,
          serverPublicId: data.serverPublicId,
          authorPublicId: data.authorPublicId
        }, '*')
      }
    })

    // @ts-ignore
    const unsubDeepLink = window.ipc.onDeepLink?.((data: any) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'NAVIGATE', ...data }, '*')
      }
    })

    // Rich Presence — forward IPC rpc:activity events into the webapp iframe
    // @ts-ignore
    const unsubRpc = window.ipc.onRpcActivity?.((activity: any) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'RPC_ACTIVITY', activity }, '*')
      }
    })

    return () => {
      window.removeEventListener('message', handleMessage)
      unsubNotif()
      unsubDeepLink?.()
      unsubRpc?.()
    }
  }, [markReady])

  const handleBack = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'NAV_BACK' }, '*')
    }
  }

  const handleForward = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'NAV_FORWARD' }, '*')
    }
  }

  const showLoading = !siteUrl || !isReady

  return (
    <React.Fragment>
      <Head>
        <title>BloumeChat</title>
      </Head>

      {/* Custom Title Bar */}
      <div
        className="fixed top-0 left-0 w-full h-[30px] bg-background/60 backdrop-blur-xl flex items-center justify-between z-[9999] border-b border-foreground/5 select-none"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        {/* Left Side: Navigation Buttons */}
        <div className="flex-1 flex items-center space-x-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button
            onClick={handleBack}
            className="w-9 h-[30px] flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
            title={t.back}
          >
            <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M 7,2 L 3,5 L 7,8" />
            </svg>
          </button>

          <button
            onClick={handleForward}
            className="w-9 h-[30px] flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
            title={t.forward}
          >
            <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M 3,2 L 7,5 L 3,8" />
            </svg>
          </button>
        </div>

        {/* Center: Logo + Text */}
        <div className="flex items-center justify-center space-x-1.5 flex-1">
          <img src="/images/logo.png" alt="Logo" className="w-3.5 h-3.5 pointer-events-none" />
          <span className="text-[12px] font-semibold text-foreground/90 pointer-events-none tracking-tight">BloumeChat</span>
        </div>

        {/* Right Side: Window Controls */}
        <div className="flex-1 flex items-center justify-end" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {platform === 'darwin' || platform === 'linux' ? (
            <div className="flex items-center space-x-2 px-2">
              <button
                // @ts-ignore
                onClick={() => window.ipc.close()}
                className="w-3 h-3 rounded-full bg-[#ff5f56] hover:brightness-90 transition-all focus:outline-none shadow-sm flex items-center justify-center group"
                title="Close"
              >
                <span className="text-[8px] text-black/50 opacity-0 group-hover:opacity-100 font-bold">×</span>
              </button>
              <button
                // @ts-ignore
                onClick={() => window.ipc.minimize()}
                className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:brightness-90 transition-all focus:outline-none shadow-sm flex items-center justify-center group"
                title="Minimize"
              >
                <span className="text-[10px] text-black/50 opacity-0 group-hover:opacity-100 font-bold leading-[0]">-</span>
              </button>
              <button
                // @ts-ignore
                onClick={() => window.ipc.maximize()}
                className="w-3 h-3 rounded-full bg-[#27c93f] hover:brightness-90 transition-all focus:outline-none shadow-sm flex items-center justify-center group"
                title="Maximize"
              >
                <span className="text-[6px] text-black/50 opacity-0 group-hover:opacity-100 font-bold">□</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center">
              <button
                // @ts-ignore
                onClick={() => window.ipc.minimize()}
                className="w-9 h-[30px] flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
              >
                <svg viewBox="0 0 10 10" className="w-2 h-2" stroke="currentColor" strokeWidth="1"><path d="M 0,5 L 10,5" /></svg>
              </button>

              <button
                // @ts-ignore
                onClick={() => window.ipc.maximize()}
                className="w-9 h-[30px] flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
              >
                <svg viewBox="0 0 10 10" className="w-2 h-2" stroke="currentColor" strokeWidth="1" fill="none"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
              </button>

              <button
                // @ts-ignore
                onClick={() => window.ipc.close()}
                className="w-10 h-[30px] flex items-center justify-center hover:bg-red-500 hover:text-white text-muted-foreground transition-colors focus:outline-none"
              >
                <svg viewBox="0 0 10 10" className="w-2 h-2" stroke="currentColor" strokeWidth="1.2"><path d="M 0,0 L 10,10 M 10,0 L 0,10" /></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Loading Screen — always rendered, fades out after 5s minimum */}
      <div
        className={`fixed inset-0 flex h-screen w-screen items-center justify-center bg-background pt-[30px] z-[9998] transition-opacity duration-700 ${showLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="flex flex-col items-center space-y-6">
          <img src="/images/logo.png" alt="BloumeChat" className="w-28 h-28 animate-bounce-subtle" />
          <h1 className="text-xl font-bold text-primary tracking-tight">{t.loading}</h1>
          {/* Loading bar */}
          <div className="w-48 h-1 bg-foreground/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-loading-bar" />
          </div>
        </div>
      </div>

      {/* Iframe — starts loading immediately but hidden behind loading screen */}
      {siteUrl && (
        <div className="w-screen h-screen pt-[30px] bg-background overflow-hidden relative">
          <iframe
            ref={iframeRef}
            src={siteUrl}
            allow="camera; microphone; display-capture; fullscreen"
            onLoad={() => setTimeout(markReady, 500)}
            className="w-full h-full border-none absolute top-[30px] left-0 right-0 bottom-0"
            style={{
              height: 'calc(100vh - 30px)',
              backgroundColor: 'hsl(var(--background))'
            }}
          />
        </div>
      )}
    </React.Fragment>
  )
}
