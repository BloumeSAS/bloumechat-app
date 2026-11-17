import type { RpcActivity } from "../../types/ipc";
import {
  BROWSERS,
  GAME_LAUNCHER_PROCS,
  GAME_MAP,
  GAME_PATH_MARKERS,
  GAME_SET,
  MUSIC_PLAYERS,
  NAME_MAP,
} from "./data";

/**
 * Strip mojibake / garbage from window titles and process names.
 * The U+FFFD replacement char (�) appears when a non-ASCII title byte is
 * mis-decoded; control chars can sneak in from odd app titles.
 */
export function sanitizeText(s: string): string {
  return (s || "")
    .replace(/�/g, "") // replacement char (mojibake)

    .replace(/[ -]/g, " ") // C0 + DEL control chars
    .replace(/\s+/g, " ") // collapse whitespace runs
    .trim();
}

/** Turn an exe/folder name into a readable title: "valorant-win64-shipping" → "Valorant". */
function prettifyName(raw: string): string {
  const cleaned = raw
    .replace(/[-_]?win(32|64)[-_]?shipping/i, "")
    .replace(/[-_]?shipping/i, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return raw;
  // Title-case short tokens, leave ALLCAPS / mixed names alone
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract the game's folder name from a Steam path (best automatic game title). */
function steamGameName(p: string): string | null {
  const m = p.match(/steamapps[\\/]+common[\\/]+([^\\/]+)/i);
  return m ? m[1].trim() : null;
}

/** True when the executable path indicates a game (and isn't a store/launcher). */
function isGamePath(p: string, lcName: string): boolean {
  if (!p) return false;
  if (GAME_LAUNCHER_PROCS.has(lcName)) return false;
  const lp = p.toLowerCase();
  return GAME_PATH_MARKERS.some((m) => lp.includes(m));
}

export function classifyActivity(
  processName: string,
  windowTitle: string,
  exePath: string,
  browserUrl: string,
): RpcActivity {
  const lc = processName.toLowerCase();

  // 1. Known games — nice curated name.
  if (GAME_SET.has(lc)) {
    return { type: "playing", name: GAME_MAP[lc] as string };
  }

  // 1b. Automatic game detection by install path (covers ALL Steam/Epic/etc. games).
  if (isGamePath(exePath, lc)) {
    const fromSteam = steamGameName(exePath);
    const name = fromSteam || NAME_MAP[lc] || prettifyName(processName);
    return { type: "playing", name };
  }

  // 2. Music players — Spotify gets rich parsing (Artist - Song)
  if (MUSIC_PLAYERS.has(lc)) {
    if (lc === "spotify" && windowTitle.includes(" - ")) {
      const dashIdx = windowTitle.indexOf(" - ");
      const artist = windowTitle.substring(0, dashIdx).trim();
      const song = windowTitle.substring(dashIdx + 3).trim();
      if (artist && song) {
        return {
          type: "listening",
          name: `${artist} — ${song}`,
          details: "Spotify",
        };
      }
    }
    return {
      type: "listening",
      name: NAME_MAP[lc] || prettifyName(processName),
    };
  }

  // 3. Browsers — strip browser name suffix, show page title
  if (BROWSERS.has(lc)) {
    const browseName = NAME_MAP[lc] || prettifyName(processName);
    const details = windowTitle
      .replace(/ - Google Chrome$/, "")
      .replace(/ [-—] Mozilla Firefox$/, "")
      .replace(/ - Microsoft.?Edge$/, "")
      .replace(/ - Opera$/, "")
      .replace(/ - Brave$/, "")
      .replace(/ - Vivaldi$/, "")
      .substring(0, 64)
      .trim();
    return {
      type: "browsing",
      name: details || browseName,
      details: browseName,
      url: browserUrl || undefined,
    };
  }

  // 4. Generic apps
  const friendlyName = NAME_MAP[lc] || prettifyName(processName);
  const details = windowTitle.substring(0, 64).trim() || undefined;
  return { type: "using", name: friendlyName, details };
}

export function activityKey(a: RpcActivity): string {
  return `${a.type}:${a.name}`;
}
