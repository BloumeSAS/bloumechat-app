// ---------------------------------------------------------------------------
export const BLOCKLIST = new Set([
  "bloumechat",
  "electron",
  "explorer",
  "searchapp",
  "searchhost",
  "startmenuexperiencehost",
  "taskmgr",
  "lockapp",
  "shellexperiencehost",
  "applicationframehost",
  "cortana",
  "textinputhost",
  "systemsettings",
  "cmd",
  "powershell",
  "windowsterminal",
  // macOS system processes
  "finder",
  "dock",
  "loginwindow",
  "notificationcenter",
  "controlstrip",
  "spotlight",
]);

// ---------------------------------------------------------------------------
// Process name → friendly display name (nicer than the raw exe name)
// ---------------------------------------------------------------------------
export const NAME_MAP: Record<string, string> = {
  code: "VS Code",
  "code - insiders": "VS Code Insiders",
  cursor: "Cursor",
  devenv: "Visual Studio",
  rider: "Rider",
  webstorm: "WebStorm",
  pycharm: "PyCharm",
  idea: "IntelliJ IDEA",
  clion: "CLion",
  goland: "GoLand",
  fleet: "JetBrains Fleet",
  notepad: "Notepad",
  "notepad++": "Notepad++",
  sublime_text: "Sublime Text",
  atom: "Atom",
  chrome: "Google Chrome",
  firefox: "Firefox",
  msedge: "Microsoft Edge",
  opera: "Opera",
  brave: "Brave",
  vivaldi: "Vivaldi",
  spotify: "Spotify",
  vlc: "VLC",
  musicbee: "MusicBee",
  foobar2000: "foobar2000",
  aimp: "AIMP",
  steam: "Steam",
  epicgameslauncher: "Epic Games Launcher",
  leagueclient: "League of Legends",
  riotclientux: "Riot Client",
  discord: "Discord",
  slack: "Slack",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  skype: "Skype",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  signal: "Signal",
  obs: "OBS Studio",
  obs64: "OBS Studio",
  photoshop: "Photoshop",
  illustrator: "Illustrator",
  afterfx: "After Effects",
  premierecc: "Premiere Pro",
  figma: "Figma",
  blender: "Blender",
  unity: "Unity",
  unrealengine: "Unreal Engine",
  godot: "Godot",
  word: "Microsoft Word",
  excel: "Microsoft Excel",
  powerpnt: "Microsoft PowerPoint",
  onenote: "Microsoft OneNote",
  outlook: "Microsoft Outlook",
  winword: "Microsoft Word",
};

// ---------------------------------------------------------------------------
// Games — optional nice-name overrides for a few popular titles. NOT required:
// game detection is automatic via the install path (see isGamePath / steamGameName).
// ---------------------------------------------------------------------------
export const GAME_MAP: Record<string, string> = {
  "valorant-win64-shipping": "Valorant",
  csgo: "CS:GO",
  cs2: "CS2",
  r5apex: "Apex Legends",
  fortniteclient: "Fortnite",
  "fortniteclient-win64-shipping": "Fortnite",
  rocketleague: "Rocket League",
  overwatch_retail: "Overwatch 2",
  dota2: "Dota 2",
  eldenring: "Elden Ring",
  cyberpunk2077: "Cyberpunk 2077",
  gta5: "GTA V",
  gtav: "GTA V",
  tf_win64: "Team Fortress 2",
  tf2: "Team Fortress 2",
  pubg: "PUBG",
  rainbowsix: "Rainbow Six Siege",
  rainbowsixgame: "Rainbow Six Siege",
  deadcells: "Dead Cells",
  hades: "Hades",
  stardewvalley: "Stardew Valley",
  among_us: "Among Us",
  witcher3: "The Witcher 3",
  darksouls3: "Dark Souls III",
  hollow_knight: "Hollow Knight",
};
export const GAME_SET = new Set(Object.keys(GAME_MAP));

// ---------------------------------------------------------------------------
// Process categories
// ---------------------------------------------------------------------------
export const BROWSERS = new Set([
  "chrome",
  "firefox",
  "msedge",
  "opera",
  "brave",
  "vivaldi",
]);
export const MUSIC_PLAYERS = new Set([
  "spotify",
  "vlc",
  "musicbee",
  "foobar2000",
  "aimp",
]);

// Install-path fragments that reliably indicate a GAME (covers thousands of titles
// automatically — no per-game list needed). CS2, for example, lives under
// "…\steamapps\common\Counter-Strike Global Offensive\…".
export const GAME_PATH_MARKERS = [
  "steamapps\\common\\",
  "\\epic games\\",
  "\\riot games\\",
  "\\gog galaxy\\games\\",
  "\\ubisoft game launcher\\games\\",
  "\\ea games\\",
  "\\electronic arts\\",
  "\\battle.net\\",
  "\\battlenet\\",
  "\\xboxgames\\",
  "\\windowsapps\\", // some Game Pass titles
];

// Store/launcher processes that live inside those folders but are NOT games.
export const GAME_LAUNCHER_PROCS = new Set([
  "steam",
  "steamwebhelper",
  "epicgameslauncher",
  "epicwebhelper",
  "riotclientservices",
  "riotclientux",
  "leagueclientux",
  "battle.net",
  "galaxyclient",
  "upc",
  "uplay",
  "eadesktop",
  "origin",
  "ealauncher",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
