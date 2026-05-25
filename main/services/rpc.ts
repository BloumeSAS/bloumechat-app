import { execFile } from 'child_process'
import type { BrowserWindow } from 'electron'
import type { RpcActivity } from '../types/ipc'

// ---------------------------------------------------------------------------
// PowerShell script — injects Win32 P/Invoke inline, no native npm deps
// ---------------------------------------------------------------------------
const PS_CMD = `
$s='[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);'
$t=Add-Type -MemberDefinition $s -Name U32 -Namespace W -PassThru
$h=$t::GetForegroundWindow(); $p=0
$t::GetWindowThreadProcessId($h,[ref]$p)|Out-Null
$x=Get-Process -Id $p -EA SilentlyContinue
if($x -and $x.MainWindowTitle){'{"n":"'+$x.ProcessName+'","t":"'+($x.MainWindowTitle-replace'"','')+'"}'}`

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
// Process name → friendly display name
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
// Games — process name → display name
// ---------------------------------------------------------------------------
const GAME_MAP: Record<string, string> = {
    'valorant-win64-shipping': 'Valorant',
    csgo:                      'CS:GO',
    cs2:                       'CS2',
    r5apex:                    'Apex Legends',
    fortniteclient:            'Fortnite',
    rocketleague:              'Rocket League',
    'overwatch_retail':        'Overwatch 2',
    dota2:                     'Dota 2',
    javaw:                     'Minecraft',
    eldenring:                 'Elden Ring',
    cyberpunk2077:             'Cyberpunk 2077',
    gtav:                      'GTA V',
    tf2:                       'Team Fortress 2',
    pubg:                      'PUBG',
    leagueclient:              'League of Legends',
    'rainbow6':                'Rainbow Six Siege',
    deadcells:                 'Dead Cells',
    hades:                     'Hades',
    stardewvalley:             'Stardew Valley',
    among_us:                  'Among Us',
    witcher3:                  'The Witcher 3',
    darksouls3:                'Dark Souls III',
    hollowknight:              'Hollow Knight',
}
const GAME_SET = new Set(Object.keys(GAME_MAP))

// ---------------------------------------------------------------------------
// Process categories
// ---------------------------------------------------------------------------
const BROWSERS = new Set(['chrome', 'firefox', 'msedge', 'opera', 'brave', 'vivaldi'])
const MUSIC_PLAYERS = new Set(['spotify', 'vlc', 'musicbee', 'foobar2000', 'aimp'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function classifyActivity(processName: string, windowTitle: string): RpcActivity {
    const lc = processName.toLowerCase()

    // 1. Games (highest priority — before music/browsers)
    if (GAME_SET.has(lc)) {
        return { type: 'playing', name: GAME_MAP[lc] as string }
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
        return { type: 'listening', name: NAME_MAP[lc] || processName }
    }

    // 3. Browsers — strip browser name suffix, show page title
    if (BROWSERS.has(lc)) {
        const browseName = NAME_MAP[lc] || processName
        const details = windowTitle
            .replace(/ - Google Chrome$/, '')
            .replace(/ - Mozilla Firefox$/, '')
            .replace(/ - Microsoft Edge$/, '')
            .replace(/ - Opera$/, '')
            .replace(/ - Brave$/, '')
            .replace(/ - Vivaldi$/, '')
            .substring(0, 64)
            .trim()
        return { type: 'browsing', name: details || browseName, details: browseName }
    }

    // 4. Generic apps
    const friendlyName = NAME_MAP[lc] || processName
    const details = windowTitle.substring(0, 64).trim() || undefined
    return { type: 'using', name: friendlyName, details }
}

function activityKey(a: RpcActivity): string {
    return `${a.type}:${a.name}`
}

// ---------------------------------------------------------------------------
// Polling state
// ---------------------------------------------------------------------------
let pollInterval: ReturnType<typeof setInterval> | null = null
let lastActivityKey = ''

// ---------------------------------------------------------------------------
// Common result handler — shared between Windows + macOS poll paths
// ---------------------------------------------------------------------------
function handlePollResult(
    processName: string,
    windowTitle: string,
    getWindow: () => BrowserWindow | null
): void {
    const lc = processName.toLowerCase().trim()
    if (!lc || BLOCKLIST.has(lc)) return

    const activity = classifyActivity(lc, windowTitle)
    const key = activityKey(activity)

    // Debounce — only send IPC if activity changed
    if (key === lastActivityKey) return
    lastActivityKey = key

    const win = getWindow()
    if (!win || win.isDestroyed()) return

    win.webContents.send('rpc:activity', activity)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function startRpcPolling(
    getWindow: () => BrowserWindow | null,
    isEnabled: () => boolean
): void {
    if (pollInterval !== null) return // already running

    const poll = () => {
        if (!isEnabled()) return

        if (process.platform === 'win32') {
            execFile(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', PS_CMD],
                { timeout: 2500 },
                (err, stdout) => {
                    if (err || !stdout.trim()) return
                    let parsed: { n: string; t: string }
                    try {
                        parsed = JSON.parse(stdout.trim())
                    } catch {
                        return
                    }
                    handlePollResult(parsed.n || '', parsed.t || '', getWindow)
                }
            )
        } else if (process.platform === 'darwin') {
            execFile(
                'osascript',
                ['-e', MACOS_CMD],
                { timeout: 3000 },
                (err, stdout) => {
                    if (err || !stdout.trim()) return
                    const raw = stdout.trim()
                    const pipeIdx = raw.indexOf('|')
                    if (pipeIdx === -1) return
                    const procName = raw.substring(0, pipeIdx).trim()
                    const winTitle = raw.substring(pipeIdx + 1).trim()
                    handlePollResult(procName, winTitle, getWindow)
                }
            )
        }
        // Linux / other platforms: not supported (no reliable cross-distro foreground window API)
    }

    // Run immediately then every 10s
    poll()
    pollInterval = setInterval(poll, 10_000)
}

export function stopRpcPolling(): void {
    if (pollInterval !== null) {
        clearInterval(pollInterval)
        pollInterval = null
    }
    lastActivityKey = ''
}
