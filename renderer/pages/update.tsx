import React, { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import {
  detectLang,
  getDict,
  resolveLang,
  type SupportedLang,
} from "../lib/i18n";

// Minimal self-contained UI components
const cn = (...classes: any[]) => classes.filter(Boolean).join(" ");

const Button = ({
  className,
  variant = "default",
  size = "default",
  ...props
}: any) => {
  const variants: any = {
    default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
    outline:
      "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground",
  };
  const sizes: any = {
    default: "h-10 px-4 py-2",
    sm: "h-8 px-3 text-xs",
    icon: "h-9 w-9",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
};

const Progress = ({
  value,
  className,
}: {
  value: number;
  className?: string;
}) => (
  <div
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
      className,
    )}
  >
    <div
      className="h-full w-full flex-1 bg-primary transition-all duration-300"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </div>
);

const Icons = {
  ArrowLeft: () => (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="19" y1="12" x2="5" y2="12"></line>
      <polyline points="12 19 5 12 12 5"></polyline>
    </svg>
  ),
  RefreshCw: ({ className }: any) => (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="23 4 23 10 17 10"></polyline>
      <polyline points="1 20 1 14 7 14"></polyline>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>
  ),
  Download: ({ className }: any) => (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  ),
  CheckCircle: ({ className }: any) => (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
  ),
  AlertCircle: ({ className }: any) => (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
  ),
};

export default function UpdatePage() {
  // Seeded synchronously from the OS locale (never a hardcoded 'fr') so there's no
  // visible language flash on mount; upgraded to the account's language below.
  const [lang, setLang] = useState<SupportedLang>(() => detectLang());
  const [updateInfo, setUpdateInfo] = useState<{
    status:
      | "checking"
      | "available"
      | "not-available"
      | "downloading"
      | "downloaded"
      | "error"
      | "idle";
    progress?: any;
    info?: any;
    message?: string;
  }>({ status: "idle" });

  const dict: Record<string, string> = getDict(lang).update;

  const t = (key: string, variables?: Record<string, any>) => {
    let text = dict[key] || key;
    if (variables) {
      Object.keys(variables).forEach((k) => {
        text = text.replace(`{{${k}}}`, variables[k]);
      });
    }
    return text;
  };

  useEffect(() => {
    if (typeof window !== "undefined" && window.ipc?.getAccountLanguage) {
      window.ipc
        .getAccountLanguage()
        .then((accountLang: string | null) => {
          setLang(resolveLang(accountLang));
        })
        .catch(() => {
          /* keep OS-detected lang */
        });
    }

    if (typeof window !== "undefined" && window.ipc) {
      const unsubscribe = window.ipc.onUpdateStatus((data: any) => {
        setUpdateInfo(data);
      });

      // Auto check on mount
      window.ipc.checkForUpdates();

      return () => {
        unsubscribe();
      };
    }
  }, []);

  const handleRestart = () => {
    window.ipc.quitAndInstall();
  };

  const handleCheck = () => {
    setUpdateInfo({ status: "checking" });
    window.ipc.checkForUpdates();
  };

  const handleDownload = () => {
    setUpdateInfo({ status: "downloading" });
    window.ipc.startDownload();
  };

  const handleIgnore = () => {
    window.ipc.ignoreUpdate();
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground font-sans overflow-hidden">
      <Head>
        <title>{t("title")}</title>
      </Head>

      {/* Modern TitleBar Space */}
      <div
        className="h-8 flex items-center px-4 shrink-0 transition-all duration-300"
        style={{ WebkitAppRegion: "drag" } as any}
      >
        <Link
          href="/home"
          style={{ WebkitAppRegion: "no-drag" } as any}
          onClick={handleIgnore}
        >
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Icons.ArrowLeft />
          </Button>
        </Link>
        <span className="text-[10px] uppercase tracking-widest font-bold ml-2 opacity-50">
          {t("system_update")}
        </span>
      </div>

      <main className="flex-1 flex flex-col items-center justify-center p-8 max-w-md mx-auto w-full text-center">
        <div className="mb-8 relative">
          <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full scale-150 animate-pulse" />
          <div className="relative bg-card border border-border/50 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-md">
            {updateInfo.status === "checking" && (
              <Icons.RefreshCw className="h-16 w-16 text-primary animate-spin" />
            )}
            {updateInfo.status === "available" && (
              <Icons.Download className="h-16 w-16 text-primary animate-bounce decoration-double" />
            )}
            {updateInfo.status === "downloading" && (
              <Icons.Download className="h-16 w-16 text-primary animate-pulse" />
            )}
            {updateInfo.status === "downloaded" && (
              <Icons.CheckCircle className="h-16 w-16 text-green-500 animate-in zoom-in duration-500" />
            )}
            {updateInfo.status === "error" && (
              <Icons.AlertCircle className="h-16 w-16 text-destructive animate-shake" />
            )}
            {(updateInfo.status === "not-available" ||
              updateInfo.status === "idle") && (
              <Icons.CheckCircle className="h-16 w-16 text-primary opacity-30" />
            )}
          </div>
        </div>

        <h1 className="text-3xl font-black mb-3 tracking-tighter">
          {updateInfo.status === "checking" && t("checking")}
          {updateInfo.status === "available" && t("available")}
          {updateInfo.status === "not-available" && t("uptodate")}
          {updateInfo.status === "downloading" && t("downloading")}
          {updateInfo.status === "downloaded" && t("ready")}
          {updateInfo.status === "error" && t("error")}
          {updateInfo.status === "idle" && t("general_title")}
        </h1>

        <p className="text-muted-foreground text-sm mb-10 leading-relaxed font-medium">
          {updateInfo.status === "checking" && t("checking_desc")}
          {updateInfo.status === "available" &&
            t("available_desc", { version: updateInfo.info?.version })}
          {updateInfo.status === "not-available" && t("uptodate_desc")}
          {updateInfo.status === "downloading" && t("downloading_desc")}
          {updateInfo.status === "downloaded" && t("ready_desc")}
          {updateInfo.status === "error" && updateInfo.message}
          {updateInfo.status === "idle" && t("idle_desc")}
        </p>

        {updateInfo.status === "downloading" && (
          <div className="w-full space-y-3 mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Progress value={updateInfo.progress?.percent || 0} />
            <div className="flex justify-between text-[11px] uppercase tracking-widest font-black opacity-40 px-1">
              <span>{Math.round(updateInfo.progress?.percent || 0)}%</span>
              <span>
                {Math.round(
                  ((updateInfo.progress?.bytesPerSecond || 0) / 1024 / 1024) *
                    10,
                ) / 10}{" "}
                MB/s
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4 w-full animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300">
          {updateInfo.status === "downloaded" ? (
            <Button
              onClick={handleRestart}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-14 rounded-2xl text-lg font-bold shadow-xl shadow-primary/20 transform active:scale-95 transition-all"
            >
              {t("restart_button")}
            </Button>
          ) : updateInfo.status === "available" ? (
            <Button
              onClick={handleDownload}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-14 rounded-2xl text-lg font-bold shadow-xl shadow-primary/20 transform active:scale-95 transition-all"
            >
              {t("download_button")}
            </Button>
          ) : (
            <Button
              onClick={handleCheck}
              disabled={
                updateInfo.status === "checking" ||
                updateInfo.status === "downloading"
              }
              variant="outline"
              className="w-full h-14 rounded-2xl border-border/60 hover:bg-accent transition-all text-base font-bold"
            >
              {updateInfo.status === "not-available"
                ? t("recheck_button")
                : t("check_button")}
            </Button>
          )}

          <Link href="/home" className="w-full" onClick={handleIgnore}>
            <Button
              variant="ghost"
              className="w-full h-10 text-muted-foreground/60 hover:text-foreground text-xs uppercase tracking-widest font-black"
            >
              {t("ignore_button")}
            </Button>
          </Link>
        </div>
      </main>

      <footer className="p-8 text-center shrink-0">
        <p className="text-[9px] uppercase tracking-[0.4em] font-black opacity-20">
          {t("footer")}
        </p>
      </footer>

      {/* Plain global <style>, not styled-jsx's `<style jsx global>` — the latter's
          JSX prop typing depends on styled-jsx's ambient type augmentation being
          resolved, which isn't reliable outside a real `next build` (broke `tsc`
          in CI with a fresh install, even though it worked locally). This global
          keyframe injection doesn't need styled-jsx's scoping anyway. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes shake {
          0%,
          100% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-4px);
          }
          75% {
            transform: translateX(4px);
          }
        }
        .animate-shake {
          animation: shake 0.2s ease-in-out 0s 2;
        }
      `,
        }}
      />
    </div>
  );
}
