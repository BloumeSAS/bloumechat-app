import { BrowserWindow, nativeImage } from 'electron'

// ─── State ───────────────────────────────────────────────────────────────────
let isVoiceActive = false
let isMuted = false
let isDeafened = false

// ─── Icon builders (SVG data URL — same lightweight approach as tray.ts) ───────
function svgIcon(svg: string): Electron.NativeImage {
    return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))
}

function micIcon(muted: boolean): Electron.NativeImage {
    const color = muted ? '#e53e3e' : '#22c55e'
    const slash = muted
        ? '<line x1="2" y1="2" x2="14" y2="14" stroke="white" stroke-width="1.8"/>'
        : ''
    return svgIcon(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">` +
        `<circle cx="8" cy="8" r="8" fill="${color}"/>` +
        `<rect x="6" y="3" width="4" height="6" rx="2" fill="white"/>` +
        `<path d="M4 9a4 4 0 0 0 8 0" stroke="white" stroke-width="1.5" fill="none"/>` +
        `<line x1="8" y1="13" x2="8" y2="15" stroke="white" stroke-width="1.5"/>` +
        `<line x1="6" y1="15" x2="10" y2="15" stroke="white" stroke-width="1.5"/>` +
        slash +
        `</svg>`
    )
}

function deafenIcon(deafened: boolean): Electron.NativeImage {
    const color = deafened ? '#e53e3e' : '#6b7280'
    const slash = deafened
        ? '<line x1="2" y1="2" x2="14" y2="14" stroke="white" stroke-width="1.8"/>'
        : ''
    return svgIcon(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">` +
        `<circle cx="8" cy="8" r="8" fill="${color}"/>` +
        `<path d="M4 9v-1a4 4 0 0 1 8 0v1" stroke="white" stroke-width="1.5" fill="none"/>` +
        `<rect x="3" y="8" width="2.5" height="4" rx="1" fill="white"/>` +
        `<rect x="10.5" y="8" width="2.5" height="4" rx="1" fill="white"/>` +
        slash +
        `</svg>`
    )
}

// ─── Apply ───────────────────────────────────────────────────────────────────
function applyThumbar(win: BrowserWindow) {
    if (process.platform !== 'win32') return
    try {
        if (!isVoiceActive) {
            win.setThumbarButtons([])
            return
        }
        win.setThumbarButtons([
            {
                tooltip: isMuted ? 'Activer le micro' : 'Couper le micro',
                icon: micIcon(isMuted),
                click: () => win.webContents.send('thumbar:toggle-mute'),
            },
            {
                tooltip: isDeafened ? 'Réactiver le son' : 'Couper le son',
                icon: deafenIcon(isDeafened),
                click: () => win.webContents.send('thumbar:toggle-deafen'),
            },
        ])
    } catch (e) {
        console.warn('[Thumbar] setThumbarButtons failed:', e)
    }
}

// ─── Public handlers ─────────────────────────────────────────────────────────
/** Call alongside handleSetVoiceActive — shows/hides the mute+deafen buttons. */
export function handleThumbarVoiceActive(active: boolean, win: BrowserWindow | null) {
    isVoiceActive = active
    if (!active) { isMuted = false; isDeafened = false }
    if (win) applyThumbar(win)
}

export function handleSetMuteState(raw: unknown, win: BrowserWindow | null) {
    if (!raw || typeof raw !== 'object') return
    const data = raw as Record<string, unknown>
    if (typeof data.isMuted !== 'boolean' || typeof data.isDeafened !== 'boolean') return
    isMuted = data.isMuted
    isDeafened = data.isDeafened
    if (win) applyThumbar(win)
}
