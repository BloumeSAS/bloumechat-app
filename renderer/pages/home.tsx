import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import Head from "next/head";
import { detectLang, getDict, resolveLang } from "../lib/i18n";
import { applyAccentColor } from "../lib/color";
import { UpdateBar, UPDATE_BAR_HEIGHT } from "../components/UpdateBar";
import { OfflineOverlay } from "../components/OfflineOverlay";
import { TitleBar } from "../components/TitleBar";

export default function HomePage() {
  const [siteUrl, setSiteUrl] = useState("");
  const [platform, setPlatform] = useState<string>("win32");
  const [isReady, setIsReady] = useState(false);
  const [siteOffline, setSiteOffline] = useState(false);
  const [updateBarVisible, setUpdateBarVisible] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const siteOriginRef = useRef("*"); // narrowed once siteUrl is known
  const readySetRef = useRef(false);
  // Seeded synchronously from the OS locale (no flash), upgraded to the account's
  // language once the webapp iframe reports it (see LANGUAGE_CHANGED below) or,
  // on the very next launch, from what got cached from that report last time.
  const [lang, setLang] = useState(() => detectLang());
  const t = useMemo(() => getDict(lang).home, [lang]);
  const tUpdate = useMemo(() => getDict(lang).update, [lang]);

  const markReady = useCallback(() => {
    if (readySetRef.current) return;
    readySetRef.current = true;
    setIsReady(true);
    window.ipc?.notifyAppReady?.();
  }, []);

  // --- Apply system theme immediately on mount ---
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Detect system dark mode preference
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

    const applySystemTheme = () => {
      if (prefersDark.matches) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };

    // Apply immediately
    applySystemTheme();

    // Listen for system theme changes (user switches Windows dark/light mode)
    const handleSystemThemeChange = () => applySystemTheme();
    prefersDark.addEventListener("change", handleSystemThemeChange);

    return () => {
      prefersDark.removeEventListener("change", handleSystemThemeChange);
    };
  }, []);

  // Fallback: show app after 8s even if iframe never fires load or APP_READY
  useEffect(() => {
    if (!siteUrl) return;
    const fallback = setTimeout(markReady, 8000);
    return () => clearTimeout(fallback);
  }, [siteUrl, markReady]);

  useEffect(() => {
    const fetchEnv = async () => {
      const baseUrl =
        (await window.ipc.getEnv("NEXT_PUBLIC_SITE_URL")) ||
        "https://bloumechat.com";
      try {
        siteOriginRef.current = new URL(String(baseUrl)).origin;
      } catch {
        /* keep '*' */
      }
      setSiteUrl(`${baseUrl}/app?platform=desktop`);

      const p = (await window.ipc.getPlatform?.()) || "win32";
      setPlatform(p);
    };
    fetchEnv();

    // Seed from whatever was cached last session (previous login, or that
    // session's own PC-detected default) before the iframe has even loaded.
    window.ipc
      .getAccountLanguage?.()
      .then((accountLang: string | null) => {
        setLang(resolveLang(accountLang));
      })
      .catch(() => {
        /* keep OS-detected lang */
      });

    // Same seeding for the accent color, so the title bar tints correctly
    // before the iframe has loaded on this and future launches.
    window.ipc
      .getAccountAccentColor?.()
      .then((accentColor: string | null) => {
        applyAccentColor(accentColor);
      })
      .catch(() => {
        /* keep default Argon-blue palette */
      });

    // Listen for theme/language changes from the iframe (Bloumechat main site)
    const handleMessage = (event: MessageEvent) => {
      // Only the bloumechat.com iframe is a legitimate sender — without this check,
      // any compromised content with a handle to this window could drive window.ipc.
      if (event.origin !== siteOriginRef.current) return;

      if (event.data?.type === "APP_READY") {
        markReady();
      } else if (event.data?.type === "THEME_CHANGED") {
        const theme = event.data.theme;
        if (theme === "dark") {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      } else if (event.data?.type === "LANGUAGE_CHANGED") {
        // The account's language (or the webapp's own browser-detected default
        // when logged out) — cache it so it's available immediately next launch,
        // even before this iframe has loaded (screen picker, updater, tray...).
        const language = event.data.language;
        if (typeof language === "string" && language) {
          setLang(resolveLang(language));
          window.ipc.setAccountLanguage?.(language);
        }
      } else if (event.data?.type === "ACCENT_COLOR_CHANGED") {
        // Same caching rationale as LANGUAGE_CHANGED above, but for the
        // account's accent color tinting the native title bar's --primary.
        const accentColor = event.data.accentColor;
        if (typeof accentColor === "string" && accentColor) {
          applyAccentColor(accentColor);
          window.ipc.setAccountAccentColor?.(accentColor);
        }
      } else if (event.data?.type === "SHOW_NOTIFICATION") {
        window.ipc.showNotification(event.data.notification);
      } else if (event.data?.type === "SET_BADGE_COUNT") {
        window.ipc.setBadgeCount(event.data.count ?? 0);
      } else if (event.data?.type === "SET_VOICE_ACTIVE") {
        window.ipc.setVoiceActive(event.data.active === true);
      } else if (event.data?.type === "IPC_INVOKE") {
        const { id, method, args } = event.data;
        const ipc = window.ipc;

        // Convert dash-case from webapp to camelCase used in desktop app
        const methodMap: Record<string, string> = {
          "get-auto-launch": "getAutoLaunch",
          "set-auto-launch": "setAutoLaunch",
          "get-minimize-to-tray": "getMinimizeToTray",
          "set-minimize-to-tray": "setMinimizeToTray",
          "get-zoom-level": "getZoomLevel",
          "set-zoom-level": "setZoomLevel",
          "write-to-clipboard": "writeToClipboard",
          "get-app-version": "getAppVersion",
          "get-rpc-enabled": "getRpcEnabled",
          "set-rpc-enabled": "setRpcEnabled",
          "get-rpc-show-using": "getRpcShowUsing",
          "set-rpc-show-using": "setRpcShowUsing",
          "get-rpc-show-browsing": "getRpcShowBrowsing",
          "set-rpc-show-browsing": "setRpcShowBrowsing",
          "get-rpc-show-listening": "getRpcShowListening",
          "set-rpc-show-listening": "setRpcShowListening",
          "get-rpc-show-playing": "getRpcShowPlaying",
          "set-rpc-show-playing": "setRpcShowPlaying",
          "get-rpc-enabled-categories": "getRpcEnabledCategories",
          "set-rpc-enabled-categories": "setRpcEnabledCategories",
          "set-mute-state": "setMuteState",
          "open-external": "openExternal",
        };

        // No fallback to the raw `method` string — only explicitly mapped methods are
        // reachable from the iframe, never the full window.ipc surface (e.g. getEnv).
        const targetMethod = methodMap[method];

        if (targetMethod && ipc && typeof ipc[targetMethod] === "function") {
          Promise.resolve(ipc[targetMethod](...args))
            .then((result) => {
              if (iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.postMessage(
                  { type: "IPC_RESPONSE", id, result },
                  siteOriginRef.current,
                );
              }
            })
            .catch((error) => {
              if (iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.postMessage(
                  { type: "IPC_RESPONSE", id, error: error.message },
                  siteOriginRef.current,
                );
              }
            });
        }
      }
    };

    window.addEventListener("message", handleMessage);

    const unsubNotif = window.ipc.onNotificationClick((data: any) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          {
            type: "NAVIGATE",
            channelPublicId: data.channelPublicId,
            serverPublicId: data.serverPublicId,
            authorPublicId: data.authorPublicId,
          },
          siteOriginRef.current,
        );
      }
    });

    const unsubDeepLink = window.ipc.onDeepLink?.((data) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: "NAVIGATE", ...data },
          siteOriginRef.current,
        );
      }
    });

    // A same-origin target="_blank"/window.open() link was clicked somewhere in the
    // iframe (chat message, embed, invite link...) — the main process denied the
    // popup (see background.ts setWindowOpenHandler) and asks us to load it in the
    // SAME visible iframe instead, so the app never shows a second window/page.
    const unsubNavigateIframe = window.ipc.on(
      "navigate-iframe",
      (url: unknown) => {
        if (typeof url === "string" && iframeRef.current) {
          iframeRef.current.src = url;
        }
      },
    );

    // Rich Presence — forward IPC rpc:activity events into the webapp iframe
    const unsubRpc = window.ipc.onRpcActivity?.((activity) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: "RPC_ACTIVITY", activity },
          siteOriginRef.current,
        );
      }
    });

    // Taskbar thumbnail toolbar — forward mute/deafen button clicks into the webapp iframe
    const unsubThumbarMute = window.ipc.onThumbarToggleMute?.(() => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: "THUMBAR_TOGGLE_MUTE" },
          siteOriginRef.current,
        );
      }
    });
    const unsubThumbarDeafen = window.ipc.onThumbarToggleDeafen?.(() => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: "THUMBAR_TOGGLE_DEAFEN" },
          siteOriginRef.current,
        );
      }
    });

    // The main process reports whether the remote site loaded (offline / DNS / server down).
    const unsubSiteStatus = window.ipc.onSiteStatus?.((status) => {
      setSiteOffline(!status.ok);
    });

    return () => {
      window.removeEventListener("message", handleMessage);
      unsubSiteStatus?.();
      unsubNotif();
      unsubDeepLink?.();
      unsubRpc?.();
      unsubThumbarMute?.();
      unsubThumbarDeafen?.();
      unsubNavigateIframe();
    };
  }, [markReady]);

  const handleBack = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "NAV_BACK" },
        siteOriginRef.current,
      );
    }
  };

  const handleForward = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "NAV_FORWARD" },
        siteOriginRef.current,
      );
    }
  };

  const showLoading = !siteUrl || !isReady;
  // Room for the update bar: the site area starts below the title bar (30px) + the bar.
  const topOffset = 30 + (updateBarVisible ? UPDATE_BAR_HEIGHT : 0);

  const retrySite = useCallback(() => {
    if (iframeRef.current && siteUrl) iframeRef.current.src = siteUrl;
  }, [siteUrl]);

  return (
    <React.Fragment>
      <Head>
        <title>BloumeChat</title>
      </Head>

      <TitleBar
        platform={platform}
        t={t}
        onBack={handleBack}
        onForward={handleForward}
      />

      <UpdateBar dict={tUpdate} onVisibleChange={setUpdateBarVisible} />

      {/* Loading Screen — always rendered, fades out after 5s minimum */}
      <div
        className={`fixed inset-0 flex h-screen w-screen items-center justify-center bg-background pt-[30px] z-[9998] transition-opacity duration-700 ${showLoading ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <div className="flex flex-col items-center space-y-6">
          <img
            src="/images/logo.png"
            alt="BloumeChat"
            className="w-28 h-28 animate-bounce-subtle"
          />
          <h1 className="text-xl font-bold text-primary tracking-tight">
            {t.loading}
          </h1>
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
            className="w-full h-full border-none absolute left-0 right-0 bottom-0"
            style={{
              top: topOffset,
              height: `calc(100vh - ${topOffset}px)`,
              backgroundColor: "hsl(var(--background))",
            }}
          />
          {siteOffline && <OfflineOverlay dict={t} onRetry={retrySite} />}
        </div>
      )}
    </React.Fragment>
  );
}
