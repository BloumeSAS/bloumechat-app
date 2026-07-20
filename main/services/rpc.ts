import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { RpcActivity } from '../types/ipc'

// ---------------------------------------------------------------------------
// Windows — persistent event-driven listener (SetWinEventHook)
// ---------------------------------------------------------------------------
// A single long-running PowerShell process, spawned once, that hooks
// EVENT_SYSTEM_FOREGROUND (window switch) and EVENT_OBJECT_NAMECHANGE (title
// change on the CURRENT foreground window — song change, browser tab, file
// switch…) and pumps a Windows message loop so those callbacks actually fire.
// Every event prints one compact JSON line to stdout the instant it happens —
// no polling delay, matching the BloumeChat RPC VS Code extension's
// event-driven feel (onDidChangeActiveTextEditor etc.) instead of a fixed tick.
// WINEVENT_OUTOFCONTEXT hooks still require the *installing* thread to pump
// messages to receive callbacks — Application::Run() does that even with no
// visible window, which is why this works without a UI.
const HOOK_PS_CMD = `
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W32H {
    public delegate void WinEventDelegate(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);
    [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
}
"@
$EVENT_SYSTEM_FOREGROUND=0x0003
$EVENT_OBJECT_NAMECHANGE=0x800C
$WINEVENT_OUTOFCONTEXT=0x0000
$OBJID_WINDOW=0
$script:fg=[W32H]::GetForegroundWindow()
$script:last=''
function Emit-Foreground([IntPtr]$h, [bool]$force) {
  if ($h -eq [IntPtr]::Zero) { return }
  $procId=0
  [W32H]::GetWindowThreadProcessId($h,[ref]$procId)|Out-Null
  if ($procId -eq 0) { return }
  $proc=Get-Process -Id $procId -EA SilentlyContinue
  if (-not $proc) { return }
  $cap=[W32H]::GetWindowTextLength($h)+1
  $sb=[System.Text.StringBuilder]::new($cap)
  [W32H]::GetWindowText($h,$sb,$cap)|Out-Null
  $title=$sb.ToString()
  if (-not $title) { $title=$proc.MainWindowTitle }
  $path=''
  try { $path=$proc.Path } catch {}
  $json=[pscustomobject]@{n=$proc.ProcessName;t=$title;p=$path}|ConvertTo-Json -Compress
  if ($force -or $json -ne $script:last) {
    $script:last=$json
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
  }
}
$callback = {
  param($hWinEventHook,$eventType,$hwnd,$idObject,$idChild,$dwEventThread,$dwmsEventTime)
  if ($eventType -eq $EVENT_SYSTEM_FOREGROUND) {
    $script:fg=$hwnd
    # Window switches always emit, even when the JSON matches the previous one:
    # A -> (own app, filtered downstream) -> A must resurface A. Dedup here would
    # swallow it and the Node side could never know the user came back.
    Emit-Foreground $hwnd $true
  } elseif ($eventType -eq $EVENT_OBJECT_NAMECHANGE -and $idObject -eq $OBJID_WINDOW -and $hwnd -eq $script:fg) {
    # Title changes on the same window are noisy (progress %, cursor pos) — dedup.
    Emit-Foreground $hwnd $false
  }
}
$delegate=[W32H+WinEventDelegate]$callback
$hookFg=[W32H]::SetWinEventHook($EVENT_SYSTEM_FOREGROUND,$EVENT_SYSTEM_FOREGROUND,[IntPtr]::Zero,$delegate,0,0,$WINEVENT_OUTOFCONTEXT)
$hookName=[W32H]::SetWinEventHook($EVENT_OBJECT_NAMECHANGE,$EVENT_OBJECT_NAMECHANGE,[IntPtr]::Zero,$delegate,0,0,$WINEVENT_OUTOFCONTEXT)
Emit-Foreground $script:fg $true
[System.Windows.Forms.Application]::Run()
`

// ---------------------------------------------------------------------------
// Windows fallback — single-shot poll (used only if the event hook can't start,
// e.g. Add-Type blocked by a corporate policy). Same P/Invoke as before, just
// invoked on a timer instead of continuously.
// ---------------------------------------------------------------------------
const PS_CMD = `
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$s='[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n); [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);'
$t=Add-Type -MemberDefinition $s -Name U32 -Namespace W -PassThru
$h=$t::GetForegroundWindow(); $p=0
$t::GetWindowThreadProcessId($h,[ref]$p)|Out-Null
$x=Get-Process -Id $p -EA SilentlyContinue
if($x){
$cap=$t::GetWindowTextLength($h)+1
$sb=[System.Text.StringBuilder]::new($cap)
$t::GetWindowText($h,$sb,$cap)|Out-Null
$title=$sb.ToString()
if(-not $title){$title=$x.MainWindowTitle}
$path=''
try{$path=$x.Path}catch{}
[pscustomobject]@{n=$x.ProcessName;t=$title;p=$path}|ConvertTo-Json -Compress
}`

// ---------------------------------------------------------------------------
// macOS osascript — gets foreground process name + window title
// Returns "processName|windowTitle" on stdout
// ---------------------------------------------------------------------------
const MACOS_CMD = `
tell application "System Events"
  set fp to first application process whose frontmost is true
  set pn to name of fp
  try
    set wt to title of first window of fp
    return pn & "|" & wt
  on error
    return pn & "|"
  end try
end tell`

// ---------------------------------------------------------------------------
// Blocklist — processes we should never broadcast as activity
// ---------------------------------------------------------------------------
const BLOCKLIST = new Set([
    'bloumechat',
    'electron',
    'explorer',
    'searchapp',
    'searchhost',
    'startmenuexperiencehost',
    'taskmgr',
    'lockapp',
    'shellexperiencehost',
    'applicationframehost',
    'cortana',
    'textinputhost',
    'systemsettings',
    'cmd',
    'powershell',
    'windowsterminal',
    // macOS system processes
    'finder',
    'dock',
    'loginwindow',
    'notificationcenter',
    'controlstrip',
    'spotlight',
])

// ---------------------------------------------------------------------------
// Process name → friendly display name (nicer than the raw exe name)
// ---------------------------------------------------------------------------
const NAME_MAP: Record<string, string> = {
    code:             'VS Code',
    'code - insiders': 'VS Code Insiders',
    cursor:           'Cursor',
    devenv:           'Visual Studio',
    rider:            'Rider',
    webstorm:         'WebStorm',
    pycharm:          'PyCharm',
    idea:             'IntelliJ IDEA',
    clion:            'CLion',
    goland:           'GoLand',
    fleet:            'JetBrains Fleet',
    notepad:          'Notepad',
    'notepad++':      'Notepad++',
    sublime_text:     'Sublime Text',
    atom:             'Atom',
    chrome:           'Google Chrome',
    firefox:          'Firefox',
    msedge:           'Microsoft Edge',
    opera:            'Opera',
    brave:            'Brave',
    vivaldi:          'Vivaldi',
    spotify:          'Spotify',
    vlc:              'VLC',
    musicbee:         'MusicBee',
    foobar2000:       'foobar2000',
    aimp:             'AIMP',
    steam:            'Steam',
    epicgameslauncher:'Epic Games Launcher',
    leagueclient:     'League of Legends',
    riotclientux:     'Riot Client',
    discord:          'Discord',
    slack:            'Slack',
    teams:            'Microsoft Teams',
    zoom:             'Zoom',
    skype:            'Skype',
    telegram:         'Telegram',
    whatsapp:         'WhatsApp',
    signal:           'Signal',
    obs:              'OBS Studio',
    obs64:            'OBS Studio',
    photoshop:        'Photoshop',
    illustrator:      'Illustrator',
    afterfx:          'After Effects',
    premierecc:       'Premiere Pro',
    figma:            'Figma',
    blender:          'Blender',
    unity:            'Unity',
    unrealengine:     'Unreal Engine',
    godot:            'Godot',
    word:             'Microsoft Word',
    excel:            'Microsoft Excel',
    powerpnt:         'Microsoft PowerPoint',
    onenote:          'Microsoft OneNote',
    outlook:          'Microsoft Outlook',
    winword:          'Microsoft Word',
}

// ---------------------------------------------------------------------------
// Games — optional nice-name overrides for a few popular titles. NOT required:
// game detection is automatic via the install path (see isGamePath / steamGameName).
// ---------------------------------------------------------------------------
const GAME_MAP: Record<string, string> = {
    'valorant-win64-shipping': 'Valorant',
    csgo:                      'CS:GO',
    cs2:                       'CS2',
    r5apex:                    'Apex Legends',
    fortniteclient:            'Fortnite',
    'fortniteclient-win64-shipping': 'Fortnite',
    rocketleague:              'Rocket League',
    'overwatch_retail':        'Overwatch 2',
    dota2:                     'Dota 2',
    eldenring:                 'Elden Ring',
    cyberpunk2077:             'Cyberpunk 2077',
    gta5:                      'GTA V',
    gtav:                      'GTA V',
    tf_win64:                  'Team Fortress 2',
    tf2:                       'Team Fortress 2',
    pubg:                      'PUBG',
    'rainbowsix':              'Rainbow Six Siege',
    'rainbowsixgame':          'Rainbow Six Siege',
    deadcells:                 'Dead Cells',
    hades:                     'Hades',
    stardewvalley:             'Stardew Valley',
    among_us:                  'Among Us',
    witcher3:                  'The Witcher 3',
    darksouls3:                'Dark Souls III',
    hollow_knight:             'Hollow Knight',
}
const GAME_SET = new Set(Object.keys(GAME_MAP))

// ---------------------------------------------------------------------------
// Process categories
// ---------------------------------------------------------------------------
const BROWSERS = new Set(['chrome', 'firefox', 'msedge', 'opera', 'brave', 'vivaldi'])
const MUSIC_PLAYERS = new Set(['spotify', 'vlc', 'musicbee', 'foobar2000', 'aimp'])

// Install-path fragments that reliably indicate a GAME (covers thousands of titles
// automatically — no per-game list needed). CS2, for example, lives under
// "…\steamapps\common\Counter-Strike Global Offensive\…".
const GAME_PATH_MARKERS = [
    'steamapps\\common\\',
    '\\epic games\\',
    '\\riot games\\',
    '\\gog galaxy\\games\\',
    '\\ubisoft game launcher\\games\\',
    '\\ea games\\',
    '\\electronic arts\\',
    '\\battle.net\\',
    '\\battlenet\\',
    '\\xboxgames\\',
    '\\windowsapps\\', // some Game Pass titles
]

// Store/launcher processes that live inside those folders but are NOT games.
const GAME_LAUNCHER_PROCS = new Set([
    'steam', 'steamwebhelper', 'epicgameslauncher', 'epicwebhelper',
    'riotclientservices', 'riotclientux', 'leagueclientux',
    'battle.net', 'galaxyclient', 'upc', 'uplay', 'eadesktop', 'origin', 'ealauncher',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Strip mojibake / garbage from window titles and process names.
 * The U+FFFD replacement char (�) appears when a non-ASCII title byte is
 * mis-decoded; control chars can sneak in from odd app titles.
 */
function sanitizeText(s: string): string {
    return (s || '')
        .replace(/�/g, '')                 // replacement char (mojibake)
        // eslint-disable-next-line no-control-regex
        .replace(/[ -]/g, ' ') // C0 + DEL control chars
        .replace(/\s+/g, ' ')                   // collapse whitespace runs
        .trim()
}

/** Turn an exe/folder name into a readable title: "valorant-win64-shipping" → "Valorant". */
function prettifyName(raw: string): string {
    const cleaned = raw
        .replace(/[-_]?win(32|64)[-_]?shipping/i, '')
        .replace(/[-_]?shipping/i, '')
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (!cleaned) return raw
    // Title-case short tokens, leave ALLCAPS / mixed names alone
    return cleaned.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Extract the game's folder name from a Steam path (best automatic game title). */
function steamGameName(p: string): string | null {
    const m = p.match(/steamapps[\\/]+common[\\/]+([^\\/]+)/i)
    return m ? m[1].trim() : null
}

/** True when the executable path indicates a game (and isn't a store/launcher). */
function isGamePath(p: string, lcName: string): boolean {
    if (!p) return false
    if (GAME_LAUNCHER_PROCS.has(lcName)) return false
    const lp = p.toLowerCase()
    return GAME_PATH_MARKERS.some((m) => lp.includes(m))
}

function classifyActivity(processName: string, windowTitle: string, exePath: string): RpcActivity {
    const lc = processName.toLowerCase()

    // 1. Known games — nice curated name.
    if (GAME_SET.has(lc)) {
        return { type: 'playing', name: GAME_MAP[lc] as string }
    }

    // 1b. Automatic game detection by install path (covers ALL Steam/Epic/etc. games).
    if (isGamePath(exePath, lc)) {
        const fromSteam = steamGameName(exePath)
        const name = fromSteam || NAME_MAP[lc] || prettifyName(processName)
        return { type: 'playing', name }
    }

    // 2. Music players — Spotify gets rich parsing (Artist - Song)
    if (MUSIC_PLAYERS.has(lc)) {
        if (lc === 'spotify' && windowTitle.includes(' - ')) {
            const dashIdx = windowTitle.indexOf(' - ')
            const artist = windowTitle.substring(0, dashIdx).trim()
            const song = windowTitle.substring(dashIdx + 3).trim()
            if (artist && song) {
                return { type: 'listening', name: `${artist} — ${song}`, details: 'Spotify' }
            }
        }
        return { type: 'listening', name: NAME_MAP[lc] || prettifyName(processName) }
    }

    // 3. Browsers — strip browser name suffix, show page title
    if (BROWSERS.has(lc)) {
        const browseName = NAME_MAP[lc] || prettifyName(processName)
        const details = windowTitle
            .replace(/ - Google Chrome$/, '')
            .replace(/ [-—] Mozilla Firefox$/, '')
            .replace(/ - Microsoft.?Edge$/, '')
            .replace(/ - Opera$/, '')
            .replace(/ - Brave$/, '')
            .replace(/ - Vivaldi$/, '')
            .substring(0, 64)
            .trim()
        return { type: 'browsing', name: details || browseName, details: browseName }
    }

    // 4. Generic apps
    const friendlyName = NAME_MAP[lc] || prettifyName(processName)
    const details = windowTitle.substring(0, 64).trim() || undefined
    return { type: 'using', name: friendlyName, details }
}

function activityKey(a: RpcActivity): string {
    return `${a.type}:${a.name}`
}

/**
 * Auto-extract the executable's own icon as a small PNG data URL.
 * Works for ANY native app or game — no icon list required. Returns undefined
 * on failure (the webapp then falls back to a brand/Lucide icon).
 */
async function getIconDataUrl(exePath: string | undefined): Promise<string | undefined> {
    if (!exePath) return undefined
    try {
        const img = await app.getFileIcon(exePath, { size: 'large' })
        if (!img || img.isEmpty()) return undefined
        const sized = img.resize({ width: 48, height: 48, quality: 'better' })
        const url = sized.toDataURL()
        // Safety cap — never broadcast an absurdly large payload.
        if (!url || url.length > 40000) return undefined
        return url
    } catch {
        return undefined
    }
}

// ---------------------------------------------------------------------------
// Shared activity pipeline — turns a raw (processName, windowTitle, exePath)
// reading (from either the Windows hook, the polling fallback, or macOS) into
// a classified RpcActivity and sends it over IPC if it actually changed.
// ---------------------------------------------------------------------------
let lastActivityKey = ''

/**
 * Returns 'changed' when a new activity was broadcast, 'blocked' when the
 * foreground app is on the blocklist (own app, shell, etc. — nothing sent),
 * or 'unchanged' when the same known activity persists.
 */
async function handleReading(
    processName: string,
    windowTitle: string,
    exePath: string,
    getWindow: () => BrowserWindow | null
): Promise<'changed' | 'blocked' | 'unchanged'> {
    const rawName = sanitizeText(processName)
    const lc = rawName.toLowerCase().trim()
    if (!lc || BLOCKLIST.has(lc)) {
        // Forget the last key while parked on a blocklisted app (incl. BloumeChat
        // itself): if the user tabs back to the SAME app they were in before, it
        // must be re-broadcast — the renderer may have cleared the server state in
        // the meantime (socket reconnect, provider effect re-run), and an
        // "unchanged" dedup here would leave the profile activity empty forever.
        lastActivityKey = ''
        return 'blocked'
    }

    const activity = classifyActivity(rawName, sanitizeText(windowTitle), exePath || '')
    const key = activityKey(activity)

    if (key === lastActivityKey) return 'unchanged'
    lastActivityKey = key

    // Auto-extract the real executable icon (any app/game). Best-effort — the
    // webapp (resolveActivityIcon) now checks its curated brand-logo map FIRST
    // and only falls back to this extracted icon for apps it doesn't recognize,
    // so this stays visually consistent with what the VS Code extension shows.
    activity.icon = await getIconDataUrl(exePath)

    const win = getWindow()
    if (!win || win.isDestroyed() || !win.webContents) return 'changed'

    win.webContents.send('rpc:activity', activity)
    return 'changed'
}

// ---------------------------------------------------------------------------
// Windows — persistent hook process lifecycle
// ---------------------------------------------------------------------------
let hookProcess: ChildProcessWithoutNullStreams | null = null
let hookStdoutBuffer = ''
let hookRestartTimer: ReturnType<typeof setTimeout> | null = null
let hookStartedAt = 0
let hookEarlyExitCount = 0
let usingPollingFallback = false

// If the hook process dies within this long of starting, count it as a
// startup failure (bad PowerShell policy, Add-Type blocked, etc.) rather than
// a transient crash — after a few of those in a row, give up on the hook and
// drop to the old single-shot polling path for the rest of the session.
const HOOK_EARLY_EXIT_MS = 5_000
const HOOK_MAX_EARLY_EXITS = 3
const HOOK_RESTART_DELAY_MS = 2_000

function stopHookProcess(): void {
    if (hookRestartTimer !== null) {
        clearTimeout(hookRestartTimer)
        hookRestartTimer = null
    }
    if (hookProcess) {
        hookProcess.removeAllListeners()
        hookProcess.kill()
        hookProcess = null
    }
    hookStdoutBuffer = ''
}

function startHookProcess(getWindow: () => BrowserWindow | null, isEnabled: () => boolean): void {
    if (hookProcess || usingPollingFallback) return

    hookStartedAt = Date.now()
    const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', HOOK_PS_CMD],
        { windowsHide: true }
    )
    hookProcess = child

    child.stdout.on('data', (chunk: Buffer) => {
        hookStdoutBuffer += chunk.toString('utf8')
        let idx: number
        // eslint-disable-next-line no-cond-assign
        while ((idx = hookStdoutBuffer.indexOf('\n')) !== -1) {
            const line = hookStdoutBuffer.slice(0, idx).trim()
            hookStdoutBuffer = hookStdoutBuffer.slice(idx + 1)
            if (!line) continue
            if (!isEnabled()) continue
            let parsed: { n: string; t: string; p?: string | null }
            try {
                parsed = JSON.parse(line)
            } catch {
                continue
            }
            void handleReading(parsed.n || '', parsed.t || '', parsed.p || '', getWindow)
        }
    })

    child.on('error', (err) => {
        console.error('[RPC] Hook process error:', err)
    })

    child.on('exit', (code) => {
        if (hookProcess !== child) return // already superseded (stop/restart raced)
        hookProcess = null

        const ranMs = Date.now() - hookStartedAt
        if (ranMs < HOOK_EARLY_EXIT_MS) {
            hookEarlyExitCount++
            console.warn(`[RPC] Hook process exited early (code ${code}, ran ${ranMs}ms) — attempt ${hookEarlyExitCount}/${HOOK_MAX_EARLY_EXITS}`)
            if (hookEarlyExitCount >= HOOK_MAX_EARLY_EXITS) {
                console.warn('[RPC] Falling back to single-shot polling for this session')
                usingPollingFallback = true
                startPollingFallback(getWindow, isEnabled)
                return
            }
        } else {
            // Ran fine for a while then died (e.g. killed by AV) — just respawn.
            hookEarlyExitCount = 0
        }

        if (usingPollingFallback) return
        hookRestartTimer = setTimeout(() => startHookProcess(getWindow, isEnabled), HOOK_RESTART_DELAY_MS)
    })
}

// ---------------------------------------------------------------------------
// Polling fallback — used for macOS always, and for Windows only if the event
// hook repeatedly fails to start.
// ---------------------------------------------------------------------------
let pollTimer: ReturnType<typeof setTimeout> | null = null

// Adaptive interval — spawning a PowerShell/osascript process every tick has a
// real cost, so once the SAME recognized activity has been stable for a while we
// back off (up to MAX_POLL_INTERVAL_MS). Any change — including landing on our
// OWN blocklisted app, which is treated the same as a change so polling stays
// fast for the switch that's likely coming right after — snaps back to MIN.
const MIN_POLL_INTERVAL_MS = 1_500
const MAX_POLL_INTERVAL_MS = 6_000
const BACKOFF_STEP_MS = 1_500
let currentIntervalMs = MIN_POLL_INTERVAL_MS
let stableStreak = 0

function startPollingFallback(getWindow: () => BrowserWindow | null, isEnabled: () => boolean): void {
    if (pollTimer !== null) return

    const scheduleNext = () => {
        pollTimer = setTimeout(poll, currentIntervalMs)
    }

    const onPollSettled = (result: 'changed' | 'blocked' | 'unchanged') => {
        if (result === 'unchanged') {
            stableStreak++
            currentIntervalMs = Math.min(MAX_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS + stableStreak * BACKOFF_STEP_MS)
        } else {
            currentIntervalMs = MIN_POLL_INTERVAL_MS
            stableStreak = 0
        }
        scheduleNext()
    }

    const poll = () => {
        if (!isEnabled()) { scheduleNext(); return }

        if (process.platform === 'win32') {
            execFile(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', PS_CMD],
                { timeout: 2500 },
                (err, stdout) => {
                    if (err || !stdout.trim()) { onPollSettled('unchanged'); return }
                    let parsed: { n: string; t: string; p?: string | null }
                    try {
                        parsed = JSON.parse(stdout.trim())
                    } catch {
                        onPollSettled('unchanged')
                        return
                    }
                    void handleReading(parsed.n || '', parsed.t || '', parsed.p || '', getWindow).then(onPollSettled)
                }
            )
        } else if (process.platform === 'darwin') {
            execFile(
                'osascript',
                ['-e', MACOS_CMD],
                { timeout: 3000 },
                (err, stdout) => {
                    if (err || !stdout.trim()) { onPollSettled('unchanged'); return }
                    const raw = stdout.trim()
                    const pipeIdx = raw.indexOf('|')
                    if (pipeIdx === -1) { onPollSettled('unchanged'); return }
                    const procName = raw.substring(0, pipeIdx).trim()
                    const winTitle = raw.substring(pipeIdx + 1).trim()
                    // macOS: executable path not resolved here → icon falls back to brand/Lucide.
                    void handleReading(procName, winTitle, '', getWindow).then(onPollSettled)
                }
            )
        } else {
            // Linux / other platforms: not supported (no reliable cross-distro foreground window API)
            scheduleNext()
        }
    }

    currentIntervalMs = MIN_POLL_INTERVAL_MS
    stableStreak = 0
    poll()
}

function stopPollingFallback(): void {
    if (pollTimer !== null) {
        clearTimeout(pollTimer)
        pollTimer = null
    }
    currentIntervalMs = MIN_POLL_INTERVAL_MS
    stableStreak = 0
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function startRpcPolling(
    getWindow: () => BrowserWindow | null,
    isEnabled: () => boolean
): void {
    lastActivityKey = ''

    if (process.platform === 'win32') {
        usingPollingFallback = false
        hookEarlyExitCount = 0
        startHookProcess(getWindow, isEnabled)
    } else {
        startPollingFallback(getWindow, isEnabled)
    }
}

export function stopRpcPolling(): void {
    stopHookProcess()
    stopPollingFallback()
    usingPollingFallback = false
    hookEarlyExitCount = 0
    lastActivityKey = ''
}
