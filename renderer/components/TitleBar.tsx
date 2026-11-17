import React from "react";
import type { DesktopDict } from "../lib/i18n";

interface TitleBarProps {
  platform: string;
  t: DesktopDict["home"];
  onBack: () => void;
  onForward: () => void;
}

/** Custom window title bar: navigation buttons, logo, and the window controls of the OS. */
export function TitleBar({ platform, t, onBack, onForward }: TitleBarProps) {
  return (
    <div
      className="fixed top-0 left-0 w-full h-[30px] bg-background/60 backdrop-blur-xl flex items-center justify-between z-[9999] border-b border-foreground/5 select-none"
      style={{ WebkitAppRegion: "drag" } as any}
    >
      {/* Left Side: Navigation Buttons */}
      <div
        className="flex-1 flex items-center space-x-0"
        style={{ WebkitAppRegion: "no-drag" } as any}
      >
        <button
          onClick={onBack}
          className="w-9 h-[30px] flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
          title={t.back}
        >
          <svg
            viewBox="0 0 10 10"
            className="w-2.5 h-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          >
            <path d="M 7,2 L 3,5 L 7,8" />
          </svg>
        </button>

        <button
          onClick={onForward}
          className="w-9 h-[30px] flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
          title={t.forward}
        >
          <svg
            viewBox="0 0 10 10"
            className="w-2.5 h-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          >
            <path d="M 3,2 L 7,5 L 3,8" />
          </svg>
        </button>
      </div>

      {/* Center: Logo + Text */}
      <div className="flex items-center justify-center space-x-1.5 flex-1">
        <img
          src="/images/logo.png"
          alt="Logo"
          className="w-3.5 h-3.5 pointer-events-none"
        />
        <span className="text-[12px] font-semibold text-foreground/90 pointer-events-none tracking-tight">
          BloumeChat
        </span>
      </div>

      {/* Right Side: Window Controls */}
      <div
        className="flex-1 flex items-center justify-end"
        style={{ WebkitAppRegion: "no-drag" } as any}
      >
        {platform === "darwin" || platform === "linux" ? (
          <div className="flex items-center space-x-2 px-2">
            <button
              onClick={() => window.ipc.close()}
              className="w-3 h-3 rounded-full bg-[#ff5f56] hover:brightness-90 transition-all focus:outline-none shadow-sm flex items-center justify-center group"
              title="Close"
            >
              <span className="text-[8px] text-black/50 opacity-0 group-hover:opacity-100 font-bold">
                ×
              </span>
            </button>
            <button
              onClick={() => window.ipc.minimize()}
              className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:brightness-90 transition-all focus:outline-none shadow-sm flex items-center justify-center group"
              title="Minimize"
            >
              <span className="text-[10px] text-black/50 opacity-0 group-hover:opacity-100 font-bold leading-[0]">
                -
              </span>
            </button>
            <button
              onClick={() => window.ipc.maximize()}
              className="w-3 h-3 rounded-full bg-[#27c93f] hover:brightness-90 transition-all focus:outline-none shadow-sm flex items-center justify-center group"
              title="Maximize"
            >
              <span className="text-[6px] text-black/50 opacity-0 group-hover:opacity-100 font-bold">
                □
              </span>
            </button>
          </div>
        ) : (
          <div className="flex items-center">
            <button
              onClick={() => window.ipc.minimize()}
              className="w-9 h-[30px] flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
            >
              <svg
                viewBox="0 0 10 10"
                className="w-2 h-2"
                stroke="currentColor"
                strokeWidth="1"
              >
                <path d="M 0,5 L 10,5" />
              </svg>
            </button>

            <button
              onClick={() => window.ipc.maximize()}
              className="w-9 h-[30px] flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
            >
              <svg
                viewBox="0 0 10 10"
                className="w-2 h-2"
                stroke="currentColor"
                strokeWidth="1"
                fill="none"
              >
                <rect x="0.5" y="0.5" width="9" height="9" />
              </svg>
            </button>

            <button
              onClick={() => window.ipc.close()}
              className="w-10 h-[30px] flex items-center justify-center hover:bg-red-500 hover:text-white text-muted-foreground transition-colors focus:outline-none"
            >
              <svg
                viewBox="0 0 10 10"
                className="w-2 h-2"
                stroke="currentColor"
                strokeWidth="1.2"
              >
                <path d="M 0,0 L 10,10 M 10,0 L 0,10" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
