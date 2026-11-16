import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Crumb } from '../types'
import { Icon } from './Icon'

const MAX_VISIBLE_CRUMBS = 5

type PathBarProps = {
  tag: ReactNode
  crumbs: Crumb[]
  /** İlk kırıntının görünen adı (ör. `deploy@web-01`); yoksa kırıntının kendi adı. */
  rootLabel?: string
  /** Mevcut yol; düzenleme kipinde input'a gelir. */
  path: string | null
  /** Ctrl+L / ⌘L ile düzenleme kipine geçmek için dışarıdan artırılan sayaç. */
  editSignal?: number
  onNavigate?: (path: string) => void
  onRefresh?: () => void
}

/**
 * Panel yol çubuğu: protokol etiketi, chevron ile ayrılmış tıklanabilir mono kırıntılar, yenile.
 * Son parça text renginde/500 ağırlıkta; uzun yollar baştan kısalır, kök her zaman görünür.
 * Çift tık veya Ctrl+L / ⌘L yolu düzenlenebilir input'a çevirir (Enter git, Esc vazgeç).
 * Odaktaki panelin 2px turuncu üst çizgisi CSS'te `.cg-pane.is-focused .cg-pathbar` ile verilir.
 */
export function PathBar({ tag, crumbs, rootLabel, path, editSignal = 0, onNavigate, onRefresh }: PathBarProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const lastSignal = useRef(editSignal)

  const startEditing = () => {
    if (!onNavigate || path === null) return
    setDraft(path)
    setEditing(true)
  }

  useEffect(() => {
    if (editSignal !== lastSignal.current) {
      lastSignal.current = editSignal
      startEditing()
    }
    // startEditing her render'da yeniden oluşur; yalnızca sinyal değişimi tetiklemeli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSignal])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const hidden = crumbs.length > MAX_VISIBLE_CRUMBS
  const visible: (Crumb | null)[] = hidden
    ? [crumbs[0], null, ...crumbs.slice(-(MAX_VISIBLE_CRUMBS - 1))]
    : crumbs

  return (
    <div className="cg-pathbar">
      {tag}
      {editing ? (
        <input
          ref={inputRef}
          className="cg-path-input"
          aria-label="Yol"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setEditing(false)
              if (draft.trim()) onNavigate?.(draft.trim())
            }
            if (event.key === 'Escape') {
              event.stopPropagation()
              setEditing(false)
            }
          }}
        />
      ) : (
        <div className="cg-crumbs" title={path ?? undefined} onDoubleClick={startEditing}>
          {visible.map((crumb, index) => {
            const last = index === visible.length - 1
            const label = crumb ? (index === 0 && rootLabel ? rootLabel : crumb.name) : '…'
            return (
              <Fragment key={crumb ? crumb.path : 'ellipsis'}>
                {index > 0 && <Icon name="chevron-right" size={12} />}
                {last || !crumb || !onNavigate
                  ? (last ? <b>{label}</b> : <span>{label}</span>)
                  : <button className="cg-crumb" onClick={() => onNavigate(crumb.path)}>{label}</button>}
              </Fragment>
            )
          })}
        </div>
      )}
      {onRefresh && (
        <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label="Paneli yenile" title="Yenile (F5)" onClick={onRefresh}>
          <Icon name="refresh" />
        </button>
      )}
    </div>
  )
}
