import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem = {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  /** Kısayol ipucu (mono-small). */
  hint?: string
}

type ContextMenuProps = {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/**
 * Sağ tık menüsü: yüzen katman (bg-overlay + shadow-overlay, radius-lg).
 * Ok tuşlarıyla gezilir, Enter seçer, Esc / dış tık kapatır. Pencere dışına taşmaz.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    setPosition({
      left: Math.min(x, window.innerWidth - rect.width - 8),
      top: Math.min(y, window.innerHeight - rect.height - 8),
    })
    menu.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
  }, [x, y])

  useEffect(() => {
    const close = (event: Event) => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return
      onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="cg-menu"
      role="menu"
      style={position}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
          return
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]
        next?.focus()
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={item.danger ? 'is-danger' : undefined}
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          <span>{item.label}</span>
          {item.hint && <span className="cg-kbd">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
}
