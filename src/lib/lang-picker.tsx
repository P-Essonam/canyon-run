import { LANGS, LANG_NAMES, setLang, useI18n } from "./i18n"
import type { Lang } from "./i18n"

// A native select: compact, and the phone shows its own picker.
export function LangPicker({ className = "" }: { className?: string }) {
  const { lang, t } = useI18n()
  return (
    <label className={`lang ${className}`}>
      <span className="lang-code" aria-hidden="true">
        {lang.toUpperCase()}
      </span>
      <select
        value={lang}
        aria-label={t.language}
        onChange={(event) => setLang(event.target.value as Lang)}
      >
        {LANGS.map((code) => (
          <option key={code} value={code}>
            {LANG_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  )
}
