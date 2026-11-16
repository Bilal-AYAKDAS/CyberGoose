import type { PropsWithChildren } from 'react'

type ModalProps = PropsWithChildren<{
  title: string
  description?: string
  onClose: () => void
}>

export function Modal({ title, description, onClose, children }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <div>
            <div className="eyebrow">CYBERGOOSE</div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="close-button" aria-label="Kapat" onClick={onClose}>×</button>
        </header>
        {children}
      </section>
    </div>
  )
}
