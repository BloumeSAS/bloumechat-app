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
// Process categories
// ---------------------------------------------------------------------------
const BROWSERS = new Set(['chrome', 'firefox', 'msedge', 'opera', 'brave', 'vivaldi'])
const MUSIC_PLAYERS = new Set(['spotify', 'vlc', 'musicbee', 'foobar2000', 'aimp'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function classifyActivity(processName: string, windowTitle: string): RpcActivity {
    const lc = processName.toLowerCase()

    if (MUSIC_PLAYERS.has(lc)) {
        return { type: 'listening', name: NAME_MAP[lc] || processName }
    }

    if (BROWSERS.has(lc)) {
        // Strip " - Browser Name" suffix from page titles for cleaner display
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
// Public API
// ---------------------------------------------------------------------------
export function startRpcPolling(
    getWindow: () => BrowserWindow | null,
    isEnabled: () => boolean
): void {
    if (pollInterval !== null) return // already running

    const poll = () => {
        if (!isEnabled()) return

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

                const processName = (parsed.n || '').toLowerCase().trim()
                const windowTitle = (parsed.t || '').trim()

                if (!processName || BLOCKLIST.has(processName)) return

                const activity = classifyActivity(processName, windowTitle)
                const key = activityKey(activity)

                // Debounce — only send if activity changed
                if (key === lastActivityKey) return
                lastActivityKey = key

                const win = getWindow()
                if (!win || win.isDestroyed()) return

                win.webContents.send('rpc:activity', activity)
            }
        )
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
