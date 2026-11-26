import { useEffect, useId, useRef, useState } from "react"
import { LANGS, LANG_NAMES, setLang, useI18n } from "./i18n"
import type { Lang } from "./i18n"

// A select in the style of shadcn/ui: a trigger, then a menu of the three
// languages with a check on the current one. Closes on a pick, a tap
// outside or Escape; arrow keys move through it.
export function LangPicker({ className = "" }: { className?: string }) {
  const { lang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(LANGS.indexOf(lang))
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [open])

  useEffect(() => {
    if (open) items.current[active]?.focus()
  }, [open, active])

  const show = () => {
    setActive(LANGS.indexOf(lang))
    setOpen(true)
  }

  const pick = (code: Lang) => {
    setLang(code)
    setOpen(false)
    trigger.current?.focus()
  }

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false)
      trigger.current?.focus()
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      if (!open) show()
      else setActive((index) => (index + 1) % LANGS.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) show()
      else setActive((index) => (index - 1 + LANGS.length) % LANGS.length)
    } else if (event.key === "Tab") {
      setOpen(false)
    }
  }

  return (
    <div ref={root} className={`lang ${open ? "is-open" : ""} ${className}`} onKeyDown={onKey}>
      <button
        ref={trigger}
        type="button"
        className="lang-trigger"
        aria-label={t.language}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <GlobeIcon />
        <span className="lang-code">{lang.toUpperCase()}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="lang-menu" id={menuId} role="listbox" aria-label={t.language}>
          {LANGS.map((code, index) => (
            <button
              key={code}
              ref={(element) => {
                items.current[index] = element
              }}
              type="button"
              role="option"
              aria-selected={code === lang}
              tabIndex={index === active ? 0 : -1}
              className="lang-item"
              onClick={() => pick(code)}
              onPointerEnter={() => setActive(index)}
            >
              <span>{LANG_NAMES[code]}</span>
              {code === lang && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className="lang-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
