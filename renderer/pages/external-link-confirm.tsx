import React, { useEffect, useState } from "react";
import Head from "next/head";
import {
  detectLang,
  getDict,
  resolveLang,
  type SupportedLang,
} from "../lib/i18n";

/**
 * Frameless confirm modal shown before handing a link off to the system
 * browser — replaces the native `dialog.showMessageBox` previously used in
 * main/services/external-link.ts, styled the same way as the screen-share
 * picker (screen-picker.tsx) instead of a plain OS message box.
 */
export default function ExternalLinkConfirmPage() {
  const [lang, setLang] = useState<SupportedLang>(() => detectLang());
  const [url, setUrl] = useState("");

  const d = getDict(lang).externalLink;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setUrl(params.get("url") || "");

    if (window.ipc?.getAccountLanguage) {
      window.ipc
        .getAccountLanguage()
        .then((accountLang: string | null) => {
          setLang(resolveLang(accountLang));
        })
        .catch(() => {
          /* keep OS-detected lang */
        });
    }
  }, []);

  const displayUrl = url.length > 90 ? `${url.slice(0, 87)}...` : url;

  const handleOpen = () => window.ipc?.confirmExternalLink();
  const handleCancel = () => window.ipc?.cancelExternalLink();

  return (
    <div className="flex flex-col h-screen bg-[#111C44] text-white font-sans overflow-hidden select-none rounded-2xl">
      <Head>
        <title>{d.title}</title>
      </Head>

      {/* Drag titlebar */}
      <div
        className="h-8 shrink-0 flex items-center px-4"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span className="text-[10px] uppercase tracking-widest font-black opacity-40">
          {d.title}
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-7 gap-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center text-primary">
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
          </svg>
        </div>

        <p className="text-sm text-white/70 leading-snug">{d.message}</p>

        <div className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/5">
          <p className="text-xs font-mono text-white/60 truncate" title={url}>
            {displayUrl}
          </p>
        </div>
      </div>

      {/* Footer actions */}
      <div
        className="shrink-0 flex items-center justify-end gap-2 px-4 py-3 border-t border-white/5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={handleCancel}
          className="px-5 py-2 rounded-full text-sm font-bold text-white/50 hover:text-white hover:bg-white/5 transition-all"
        >
          {d.cancelButton}
        </button>
        <button
          onClick={handleOpen}
          className="px-6 py-2 rounded-full text-sm font-bold bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all"
        >
          {d.openButton}
        </button>
      </div>
    </div>
  );
}
