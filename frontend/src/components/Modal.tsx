import { useEffect, useId, useRef, type PropsWithChildren, type ReactNode } from 'react'

type ModalProps = PropsWithChildren<{
  title: string
  footer?: ReactNode
  wide?: boolean
  onClose: () => void
  /** Enter tuşu (input içindeyken) birincil eylemi tetikler. */
  onSubmit?: () => void
}>

/**
 * Diyalog kabuğu: bg-overlay, radius-lg, shadow-overlay, 440px (wide=true iken geniş).
 * Esc = Vazgeç, Enter = birincil eylem; açılınca ilk alan odak alır.
 */
export function Modal({ title, footer, wide, onClose, onSubmit, children }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    // Kapanınca odak diyaloğu açan öğeye döner (klavye kullanıcısı yerini kaybetmesin).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    // Odak asla geri alınamaz bir eyleme düşmesin: önce işaretli öğe, sonra ilk alan.
    const first = dialog?.querySelector<HTMLElement>('[data-autofocus]:not([disabled])')
      ?? dialog?.querySelector<HTMLElement>('input:not([disabled])')
      ?? dialog?.querySelector<HTMLElement>('button:not([disabled]):not(.cg-btn-danger)')
    first?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])

  return (
    <div className="cg-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={dialogRef}
        className={`cg-dialog${wide ? ' cg-dialog-wide' : ''}`}
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
