// Desktop app i18n — loads the shared JSON dictionaries under windows/locales/
// (same 30-language roster as webapp/locales: fr is the source, the rest are
// synced via windows/scripts/translate_desktop_locales.py). Replaces the old
// per-page inline `Dict = { fr: {...}, en: {...} }` objects that only ever
// covered French/English.
import fr from '../../locales/fr.json'
import ar from '../../locales/ar.json'
import bg from '../../locales/bg.json'
import cs from '../../locales/cs.json'
import da from '../../locales/da.json'
import de from '../../locales/de.json'
import el from '../../locales/el.json'
import en from '../../locales/en.json'
import es from '../../locales/es.json'
import fi from '../../locales/fi.json'
import hi from '../../locales/hi.json'
import hr from '../../locales/hr.json'
import hu from '../../locales/hu.json'
import id from '../../locales/id.json'
import it from '../../locales/it.json'
import ja from '../../locales/ja.json'
import ka from '../../locales/ka.json'
import ko from '../../locales/ko.json'
import nl from '../../locales/nl.json'
import no from '../../locales/no.json'
import pl from '../../locales/pl.json'
import pt from '../../locales/pt.json'
import ro from '../../locales/ro.json'
import ru from '../../locales/ru.json'
import sv from '../../locales/sv.json'
import th from '../../locales/th.json'
import tr from '../../locales/tr.json'
import uk from '../../locales/uk.json'
import vi from '../../locales/vi.json'
import zh from '../../locales/zh.json'

export type DesktopDict = typeof fr

const LOCALES: Record<string, DesktopDict> = {
    fr, ar, bg, cs, da, de, el, en, es, fi, hi, hr, hu, id, it, ja, ka, ko,
    nl, no, pl, pt, ro, ru, sv, th, tr, uk, vi, zh,
}

export type SupportedLang = keyof typeof LOCALES

export const SUPPORTED_LANGS = Object.keys(LOCALES) as SupportedLang[]

/** Normalizes a BCP-47 tag ("en-US", "zh-Hans-CN"...) down to our 2-letter code. */
function normalize(tag: string): string {
    return tag.toLowerCase().split(/[-_]/)[0]
}

/** Detects the best-supported language from the renderer's navigator, falling
 * back to English then French when nothing matches. */
export function detectLang(): SupportedLang {
    if (typeof navigator === 'undefined') return 'fr'
    const candidates = (navigator.languages && navigator.languages.length > 0)
        ? navigator.languages
        : [navigator.language || 'fr']
    for (const raw of candidates) {
        const code = normalize(raw)
        if (code in LOCALES) return code as SupportedLang
    }
    return 'en'
}

export function getDict(lang: string): DesktopDict {
    const code = normalize(lang)
    return LOCALES[code] || LOCALES.en || LOCALES.fr
}
