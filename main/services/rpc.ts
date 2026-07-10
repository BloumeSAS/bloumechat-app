import { execFile } from 'child_process'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { RpcActivity } from '../types/ipc'

// ---------------------------------------------------------------------------
// PowerShell script — injects Win32 P/Invoke inline, no native npm deps
// ---------------------------------------------------------------------------
// Reads the ACTUAL foreground window title (GetWindowText on the focused HWND),
// the process name AND the executable path. The path lets us:
//   • auto-detect games by their install folder (steamapps\common\…, Epic Games\…)
//   • auto-extract the real .exe icon (app.getFileIcon) — works for ANY app/game
// ConvertTo-Json handles all escaping safely (quotes, backslashes, unicode).
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
        .replace(/[ -]/g, ' ') // C0 + DEL control chars
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
// Polling state
// ---------------------------------------------------------------------------
let pollTimer: ReturnType<typeof setTimeout> | null = null
let lastActivityKey = ''

// Adaptive interval — spawning a PowerShell/osascript process every tick has a
// real cost. When the foreground activity hasn't changed for a while, back off
// (up to MAX_POLL_INTERVAL_MS); any change snaps straight back to MIN so a
// switch to a new app/game/site is still picked up quickly.
const MIN_POLL_INTERVAL_MS = 4_000
const MAX_POLL_INTERVAL_MS = 20_000
const BACKOFF_STEP_MS = 4_000
let currentIntervalMs = MIN_POLL_INTERVAL_MS
let stableStreak = 0

// ---------------------------------------------------------------------------
// Common result handler — shared between Windows + macOS poll paths
// ---------------------------------------------------------------------------
/** Returns true if the activity changed (and was broadcast), false otherwise. */
async function handlePollResult(
    processName: string,
    windowTitle: string,
    exePath: string,
    getWindow: () => BrowserWindow | null
): Promise<boolean> {
    const rawName = sanitizeText(processName)
    const lc = rawName.toLowerCase().trim()
    if (!lc || BLOCKLIST.has(lc)) return false

    const activity = classifyActivity(rawName, sanitizeText(windowTitle), exePath || '')
    const key = activityKey(activity)

    // Debounce — only send IPC if activity changed
    if (key === lastActivityKey) return false
    lastActivityKey = key

    // Auto-extract the real executable icon (any app/game). Best-effort.
    activity.icon = await getIconDataUrl(exePath)

    const win = getWindow()
    if (!win || win.isDestroyed() || !win.webContents) return true

    win.webContents.send('rpc:activity', activity)
    return true
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function startRpcPolling(
    getWindow: () => BrowserWindow | null,
    isEnabled: () => boolean
): void {
    if (pollTimer !== null) return // already running

    const scheduleNext = () => {
        pollTimer = setTimeout(poll, currentIntervalMs)
    }

    const onPollSettled = (changed: boolean) => {
        if (changed) {
            currentIntervalMs = MIN_POLL_INTERVAL_MS
            stableStreak = 0
        } else {
            stableStreak++
            currentIntervalMs = Math.min(MAX_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS + stableStreak * BACKOFF_STEP_MS)
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
                    if (err || !stdout.trim()) { onPollSettled(false); return }
                    let parsed: { n: string; t: string; p?: string | null }
                    try {
                        parsed = JSON.parse(stdout.trim())
                    } catch {
                        onPollSettled(false)
                        return
                    }
                    void handlePollResult(parsed.n || '', parsed.t || '', parsed.p || '', getWindow).then(onPollSettled)
                }
            )
        } else if (process.platform === 'darwin') {
            execFile(
                'osascript',
                ['-e', MACOS_CMD],
                { timeout: 3000 },
                (err, stdout) => {
                    if (err || !stdout.trim()) { onPollSettled(false); return }
                    const raw = stdout.trim()
                    const pipeIdx = raw.indexOf('|')
                    if (pipeIdx === -1) { onPollSettled(false); return }
                    const procName = raw.substring(0, pipeIdx).trim()
                    const winTitle = raw.substring(pipeIdx + 1).trim()
                    // macOS: executable path not resolved here → icon falls back to brand/Lucide.
                    void handlePollResult(procName, winTitle, '', getWindow).then(onPollSettled)
                }
            )
        } else {
            // Linux / other platforms: not supported (no reliable cross-distro foreground window API)
            scheduleNext()
        }
    }

    // Run immediately, then adapt the delay based on whether activity changes.
    currentIntervalMs = MIN_POLL_INTERVAL_MS
    stableStreak = 0
    poll()
}

export function stopRpcPolling(): void {
    if (pollTimer !== null) {
        clearTimeout(pollTimer)
        pollTimer = null
    }
    lastActivityKey = ''
    currentIntervalMs = MIN_POLL_INTERVAL_MS
    stableStreak = 0
}
