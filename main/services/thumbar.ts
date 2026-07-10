import { app, BrowserWindow, nativeImage } from 'electron'
import path from 'path'

// ─── State ───────────────────────────────────────────────────────────────────
let isVoiceActive = false
let isMuted = false
let isDeafened = false

// ─── Icon loading ──────────────────────────────────────────────────────────────
// IMPORTANT: Electron's nativeImage does NOT rasterize SVG — an SVG data URL
// produces an empty image, so thumbnail-toolbar buttons render blank (the old
// bug). We ship real PNGs under resources/voice/ and load them from disk.
function voiceResourcePath(file: string): string {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'voice', file)
        : path.join(app.getAppPath(), 'resources', 'voice', file)
}

// Cache the four small icons so we don't re-read them on every state change.
const iconCache = new Map<string, Electron.NativeImage>()
function loadIcon(file: string): Electron.NativeImage {
    const cached = iconCache.get(file)
    if (cached) return cached
    const img = nativeImage.createFromPath(voiceResourcePath(file))
    iconCache.set(file, img)
    return img
}

function micIcon(muted: boolean): Electron.NativeImage {
    return loadIcon(muted ? 'mic-muted.png' : 'mic.png')
}

function deafenIcon(deafened: boolean): Electron.NativeImage {
    return loadIcon(deafened ? 'deafen-muted.png' : 'deafen.png')
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
