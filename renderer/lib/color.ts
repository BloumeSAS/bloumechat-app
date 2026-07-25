/**
 * Applies (or resets) the account's accent color onto the Nextron shell's
 * native CSS variables. The shell's --primary/--ring/etc are stored as raw
 * HSL triplets ("H S% L%", see styles/globals.css) and consumed via
 * hsl(var(--primary)), so an incoming hex color must be converted first.
 */

function hexToHslTriplet(hex: string): string | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;

  const r = parseInt(match[1].slice(0, 2), 16) / 255;
  const g = parseInt(match[1].slice(2, 4), 16) / 255;
  const b = parseInt(match[1].slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return `0 0% ${Math.round(l * 100)}%`;

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  h *= 60;

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const ACCENT_VARS = ["--primary", "--ring", "--secondary-foreground", "--accent-foreground"];

/** Pass null to reset the shell back to its default Argon-blue palette. */
export function applyAccentColor(hex: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;

  if (!hex) {
    ACCENT_VARS.forEach((v) => root.removeProperty(v));
    return;
  }

  const triplet = hexToHslTriplet(hex);
  if (!triplet) return;
  ACCENT_VARS.forEach((v) => root.setProperty(v, triplet));
}
