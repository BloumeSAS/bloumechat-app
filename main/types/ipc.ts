export interface NotificationPayload {
  title: string
  body: string
  icon?: string
  channelPublicId: string
  serverPublicId?: string
  authorPublicId?: string
}

export interface DeepLinkPayload {
  action: string
  id: string
  queryParams?: Record<string, string>
}

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}

export interface RpcActivity {
  type: 'using' | 'browsing' | 'listening' | 'playing' | 'none'
  name: string
  details?: string
  startedAt?: number // unix ms, set client-side in RpcProvider
  icon?: string // data URL of the app/game .exe icon (auto-extracted via app.getFileIcon)
}

export type UpdateStatus =
  | { status: 'checking' }
  | { status: 'available'; info: { version: string } }
  | { status: 'not-available'; info: { version: string } }
  | { status: 'downloading'; progress: object }
  | { status: 'downloaded'; info: { version: string } }
  | { status: 'error'; message: string }
