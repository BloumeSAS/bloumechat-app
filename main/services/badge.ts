import zlib from 'zlib'
import { nativeImage, BrowserWindow, Tray, app } from 'electron'

const badgeIconCache = new Map<string, Electron.NativeImage>()
const voiceBadgeIconCache: { icon: Electron.NativeImage | null } = { icon: null }
let voiceBadgeInterval: NodeJS.Timeout | null = null
let isVoiceBadgeOn = false
let currentBadgeCount = 0

export function getCurrentBadgeCount() { return currentBadgeCount }

function crc32(buf: Buffer): number {
  const table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })()
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) | 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([len, typeBytes, data, crcBuf])
}

function createCirclePng(
  size: number,
  fill: [number, number, number],
  overlay?: (x: number, y: number) => [number, number, number, number]
): Electron.NativeImage {
  const pixels = Buffer.allocUnsafe(size * size * 4)
  const cx = size / 2, cy = size / 2, r = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inCircle = (x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2 <= r * r
      if (inCircle) {
        if (overlay) {
          const [or, og, ob, oa] = overlay(x, y)
          pixels[i] = or; pixels[i+1] = og; pixels[i+2] = ob; pixels[i+3] = oa
        } else {
          pixels[i] = fill[0]; pixels[i+1] = fill[1]; pixels[i+2] = fill[2]; pixels[i+3] = 255
        }
      } else {
        pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0; pixels[i+3] = 0
      }
    }
  }
  const filtered = Buffer.allocUnsafe(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    filtered[y * (1 + size * 4)] = 0
    pixels.copy(filtered, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const compressed = zlib.deflateSync(filtered)
  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return nativeImage.createFromBuffer(png)
}

export function createBadgeIcon(count: number): Electron.NativeImage | null {
  const key = String(count)
  const cached = badgeIconCache.get(key)
  if (cached) return cached
  try {
    const label = count > 99 ? '99+' : String(count)
    const size = 16
    const fontSize = label.length > 2 ? 7 : 9
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="#e53e3e"/><text x="${size/2}" y="${size/2}" text-anchor="middle" dominant-baseline="central" fill="white" font-family="Arial,sans-serif" font-weight="bold" font-size="${fontSize}">${label}</text></svg>`
    const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
    const img = nativeImage.createFromDataURL(dataUrl)
    const result = img.isEmpty() ? createCirclePng(size, [229, 62, 62]) : img
    badgeIconCache.set(key, result)
    return result
  } catch (e) {
    console.error('[Badge] Failed to create badge icon:', e)
    return null
  }
}

export function createVoiceBadgeIcon(): Electron.NativeImage {
  if (voiceBadgeIconCache.icon) return voiceBadgeIconCache.icon
  const icon = createCirclePng(16, [34, 197, 94], (x, y) => {
    const onCheck =
      (x === 5 && y === 8) || (x === 6 && y === 9) ||
      (x === 7 && y === 9) || (x === 8 && y === 8) ||
      (x === 9 && y === 7) || (x === 10 && y === 6) || (x === 11 && y === 5)
    return onCheck ? [255, 255, 255, 255] : [34, 197, 94, 255]
  })
  voiceBadgeIconCache.icon = icon
  return icon
}

export function prewarmBadgeCache() {
  for (let i = 1; i <= 20; i++) createBadgeIcon(i)
  createVoiceBadgeIcon()
}

export function handleSetBadgeCount(count: unknown, mainWindow: BrowserWindow | null) {
  if (typeof count !== 'number' || !Number.isFinite(count)) return
  currentBadgeCount = Math.max(0, Math.min(9999, Math.floor(count)))
  if (process.platform === 'win32' && mainWindow) {
    if (currentBadgeCount > 0) {
      const badgeIcon = createBadgeIcon(currentBadgeCount)
      if (badgeIcon) mainWindow.setOverlayIcon(badgeIcon, `${currentBadgeCount} message(s) non lu(s)`)
    } else if (!voiceBadgeInterval) {
      mainWindow.setOverlayIcon(null, '')
    }
  }
  app.setBadgeCount(currentBadgeCount)
}

export function handleSetVoiceActive(active: unknown, mainWindow: BrowserWindow | null, tray: Tray | null) {
  if (typeof active !== 'boolean') return
  if (!mainWindow) return

  if (active) {
    tray?.setToolTip('BloumeChat — 🎙 Vocal actif')
    if (process.platform === 'win32') {
      if (voiceBadgeInterval) return
      voiceBadgeInterval = setInterval(() => {
        isVoiceBadgeOn = !isVoiceBadgeOn
        try {
          if (isVoiceBadgeOn) {
            mainWindow.setOverlayIcon(createVoiceBadgeIcon(), 'Vocal actif')
          } else {
            if (currentBadgeCount > 0) {
              mainWindow.setOverlayIcon(createBadgeIcon(currentBadgeCount), `${currentBadgeCount} message(s) non lu(s)`)
            } else {
              mainWindow.setOverlayIcon(null, '')
            }
          }
        } catch (e) { console.warn('[Badge] setOverlayIcon failed:', e) }
      }, 800)
    }
  } else {
    tray?.setToolTip('BloumeChat')
    if (process.platform === 'win32') {
      if (voiceBadgeInterval) { clearInterval(voiceBadgeInterval); voiceBadgeInterval = null }
      isVoiceBadgeOn = false
      try {
        if (currentBadgeCount > 0) {
          mainWindow.setOverlayIcon(createBadgeIcon(currentBadgeCount), `${currentBadgeCount} message(s) non lu(s)`)
        } else {
          mainWindow.setOverlayIcon(null, '')
        }
      } catch (e) { console.warn('[Badge] restore overlay failed:', e) }
    }
  }
}
