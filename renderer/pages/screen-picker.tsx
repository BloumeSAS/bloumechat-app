import React, { useEffect, useState } from "react";
import Head from "next/head";
import {
  detectLang,
  getDict,
  resolveLang,
  type SupportedLang,
} from "../lib/i18n";

interface Source {
  id: string;
  name: string;
  thumbnail: string; // data URL
  isScreen: boolean;
}

export default function ScreenPickerPage() {
  // Seeded synchronously from the OS locale (never a hardcoded 'fr') so there's
  // no visible language flash on mount; upgraded to the account's language, if
  // any is cached, once the IPC round-trip below resolves.
  const [lang, setLang] = useState<SupportedLang>(() => detectLang());
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"screens" | "windows">("screens");
  const [loading, setLoading] = useState(true);

  const d = getDict(lang).screen_picker;

  useEffect(() => {
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

    // Request sources from main process
    if (window.ipc?.getScreenSources) {
      window.ipc.getScreenSources().then((raw: any[]) => {
        const mapped: Source[] = raw.map((s) => ({
          id: s.id,
          name: s.name,
          thumbnail: s.thumbnail,
          isScreen: s.id.startsWith("screen"),
        }));
        setSources(mapped);
        // Auto-select first screen
        const firstScreen = mapped.find((s) => s.isScreen);
        if (firstScreen) setSelected(firstScreen.id);
        setLoading(false);
      });
    }
  }, []);

  const handleShare = () => {
    if (!selected) return;
    window.ipc?.selectScreenSource(selected);
  };

  const handleCancel = () => {
    window.ipc?.cancelScreenSource();
  };

  const filtered = sources.filter((s) =>
    tab === "screens" ? s.isScreen : !s.isScreen,
  );

  return (
    <div className="flex flex-col h-screen bg-[#111C44] text-white font-sans overflow-hidden select-none">
      <Head>
        <title>{d.title}</title>
      </Head>

      {/* Drag titlebar — language now follows the account/PC automatically,
                no manual EN/FR-only toggle (it hid 28 of the 30 supported langs). */}
      <div
        className="h-8 shrink-0 flex items-center px-3"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span className="text-[10px] uppercase tracking-widest font-black opacity-40">
          {d.heading}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 pb-2 shrink-0 border-b border-white/5">
        {(["screens", "windows"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              tab === t
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {t === "screens" ? d.screens : d.windows}
          </button>
        ))}
      </div>

      {/* Sources grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center h-full text-white/30 text-sm">
            {d.loading}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/30 text-sm">
            {d.noSources}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((source) => (
              <button
                key={source.id}
                onClick={() => setSelected(source.id)}
                onDoubleClick={handleShare}
                className={`group relative rounded-xl overflow-hidden border-2 transition-all bg-black/30 text-left ${
                  selected === source.id
                    ? "border-primary shadow-lg shadow-primary/20 scale-[1.02]"
                    : "border-white/5 hover:border-white/20"
                }`}
              >
                {/* Thumbnail */}
                <div className="aspect-video w-full overflow-hidden bg-black/50">
                  {source.thumbnail ? (
                    <img
                      src={source.thumbnail}
                      alt={source.name}
                      className="w-full h-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center opacity-20">
                      <svg
                        viewBox="0 0 24 24"
                        width="32"
                        height="32"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <rect x="2" y="3" width="20" height="14" rx="2" />
                        <path d="M8 21h8M12 17v4" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Label */}
                <div className="px-2 py-1.5 flex items-center gap-1.5">
                  {selected === source.id && (
                    <div className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />
                  )}
                  <span className="text-xs font-medium truncate text-white/80 group-hover:text-white transition-colors">
                    {source.name}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div
        className="shrink-0 flex items-center justify-end gap-2 px-3 py-3 border-t border-white/5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={handleCancel}
          className="px-5 py-2 rounded-full text-sm font-bold text-white/50 hover:text-white hover:bg-white/5 transition-all"
        >
          {d.cancel}
        </button>
        <button
          onClick={handleShare}
          disabled={!selected}
          className="px-6 py-2 rounded-full text-sm font-bold bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {d.share}
        </button>
      </div>
    </div>
  );
}
