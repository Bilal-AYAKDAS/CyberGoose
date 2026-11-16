import { useEffect, useId, useRef, type PropsWithChildren, type ReactNode } from 'react'

type ModalProps = PropsWithChildren<{
  title: string
  footer?: ReactNode
  onClose: () => void
  /** Enter tuşu (input içindeyken) birincil eylemi tetikler. */
  onSubmit?: () => void
}>

/**
 * Diyalog kabuğu: bg-overlay, radius-lg, shadow-overlay, 440px.
 * Esc = Vazgeç, Enter = birincil eylem; açılınca ilk alan odak alır.
 */
export function Modal({ title, footer, onClose, onSubmit, children }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const first = dialog?.querySelector<HTMLElement>('input:not([disabled])') ?? dialog?.querySelector<HTMLElement>('button:not([disabled])')
    first?.focus()
  }, [])

  return (
    <div className="cg-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={dialogRef}
        className="cg-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
          if (event.key === 'Enter' && onSubmit && event.target instanceof HTMLInputElement) {
            event.preventDefault()
            onSubmit()
          }
        }}
      >
        <header id={titleId}>{title}</header>
        {children}
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  )
}
