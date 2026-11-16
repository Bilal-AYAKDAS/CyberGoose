import { useEffect, useRef } from 'react'

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}

export function useKeyboardShortcuts(handler: (event: KeyboardEvent) => void, disabled: boolean) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if ((mod && (key === 'l' || key === 'f')) || !isTypingTarget(event.target)) {
        ref.current(event)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [disabled])
}
