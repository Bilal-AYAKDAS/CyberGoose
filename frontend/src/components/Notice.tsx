import type { ReactNode } from 'react'
import { Icon } from './Icon'

type NoticeProps = {
  tone?: 'warn' | 'error' | 'ok'
  title: string
  children?: ReactNode
  action?: ReactNode
}

/**
 * Satır içi bildirim bandı. Zemin status-*-soft, ikon status-*, metin text.
 * Hata ve uyarılar kendiliğinden kapanmaz; güvenlik kararları her zaman bununla sorulur.
 */
export function Notice({ tone = 'warn', title, children, action }: NoticeProps) {
  const className = tone === 'warn' ? 'cg-notice' : `cg-notice ${tone}`
  return (
    <div className={className} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'ok' ? 'info' : 'alert'} />
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      {action ?? <span />}
    </div>
  )
}
