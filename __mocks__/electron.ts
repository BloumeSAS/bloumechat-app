// Manual Jest mock for the 'electron' module — main-process services import real
// electron APIs (app, dialog, shell, BrowserWindow, nativeImage...) that don't exist
// outside a running Electron process. Jest auto-uses this file (in __mocks__/ next
// to node_modules) for every `import ... from 'electron'` in tests, no per-test
// jest.mock('electron') call needed. Extend as new services grow test coverage —
// keep it a thin stub, not a behavioral reimplementation.

export const app = {
  getLocale: jest.fn(() => "en-US"),
  getVersion: jest.fn(() => "0.0.0-test"),
  setBadgeCount: jest.fn(),
  getPath: jest.fn(() => "/tmp"),
  quit: jest.fn(),
  isPackaged: false,
};

export const dialog = {
  showMessageBox: jest.fn(async () => ({
    response: 1,
    checkboxChecked: false,
  })),
};

export const shell = {
  openExternal: jest.fn(async () => undefined),
};

export const nativeImage = {
  createFromDataURL: jest.fn(() => ({ isEmpty: () => false })),
  createFromBuffer: jest.fn(() => ({ isEmpty: () => false })),
  createFromPath: jest.fn(() => ({
    isEmpty: () => false,
    resize: jest.fn(() => ({ isEmpty: () => false })),
  })),
  createEmpty: jest.fn(() => ({ isEmpty: () => true })),
};

export class BrowserWindow {
  static getFocusedWindow = jest.fn(() => null);
  webContents = {
    send: jest.fn(),
    on: jest.fn(),
    setZoomLevel: jest.fn(),
    getZoomLevel: jest.fn(() => 0),
  };
  show = jest.fn();
  focus = jest.fn();
  isDestroyed = jest.fn(() => false);
  close = jest.fn();
  on = jest.fn();
}

export const ipcMain = {
  on: jest.fn(),
  handle: jest.fn(),
  removeListener: jest.fn(),
};

export const desktopCapturer = {
  getSources: jest.fn(async () => []),
};

export const Notification = jest.fn().mockImplementation(() => ({
  on: jest.fn(),
  show: jest.fn(),
}));

export const Tray = jest.fn();
export const Menu = { buildFromTemplate: jest.fn() };
export const clipboard = { writeText: jest.fn(), readText: jest.fn(() => "") };
export const globalShortcut = { register: jest.fn(), unregisterAll: jest.fn() };
export const powerMonitor = { on: jest.fn() };
export const session = { defaultSession: {} };
export const crashReporter = { start: jest.fn() };
