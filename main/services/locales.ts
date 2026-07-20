// Main-process i18n loader — same shared JSON dictionaries as the renderer
// (windows/locales/*.json, see renderer/lib/i18n.ts for the renderer-side
// equivalent and windows/scripts/translate_desktop_locales.py for how the 29
// non-French files are kept in sync with fr.json).
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

const LOCALES = {
    fr, ar, bg, cs, da, de, el, en, es, fi, hi, hr, hu, id, it, ja, ka, ko,
    nl, no, pl, pt, ro, ru, sv, th, tr, uk, vi, zh,
}

export type SupportedLocale = keyof typeof LOCALES

export function getLocaleDict(locale: string) {
    const code = locale.toLowerCase().split(/[-_]/)[0]
    return (LOCALES as Record<string, typeof fr>)[code] || LOCALES.en
}

/** Maps an Electron `app.getLocale()` BCP-47 tag ("fr-FR", "zh-Hans-CN"...)
 * down to one of our 30 supported 2-letter codes, falling back to English. */
export function resolveSupportedLocale(rawLocale: string | undefined): SupportedLocale {
    const code = (rawLocale || 'fr').toLowerCase().split(/[-_]/)[0]
    return (code in LOCALES ? code : 'en') as SupportedLocale
}
