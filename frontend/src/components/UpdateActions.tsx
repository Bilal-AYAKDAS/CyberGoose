import type { InstallState } from '../hooks/useUpdateCheck'
import type { UpdateInfo } from '../types/electron'
import { formatFileSize } from '../utils/formatters'

export type UpdateActionsProps = {
  info: UpdateInfo
  /** Paket uygulama içinden indirilip kurulabilir. Değilse indirme sayfası tarayıcıda açılır. */
  canInstall: boolean
  install: InstallState
  onInstall: () => void
  onRestart: () => void
  onOpenPage: (url: string) => void
  small?: boolean
}

function percent(install: InstallState) {
  const { received = 0, total = null } = install.progress ?? {}
  return total ? Math.min(100, Math.round((received / total) * 100)) : null
}

/**
 * Yeni sürüm düğmeleri: "Kur" → indirme ilerlemesi → "Yeniden başlat". Kurulum yapılamıyorsa
 * (geliştirme modu, yazılamayan klasör, hata) indirme sayfasına bağlantı verilir.
 */
export function UpdateActions({ info, canInstall, install, onInstall, onRestart, onOpenPage, small }: UpdateActionsProps) {
  const size = small ? ' cg-btn-sm' : ''
  const pageButton = info.url
    ? <button className={`cg-btn${size}${canInstall ? '' : ' cg-btn-primary'}`} onClick={() => onOpenPage(info.url)}>{canInstall ? 'İndirme sayfası' : `${info.latest} sürümünü indir`}</button>
    : null
  if (!canInstall) return pageButton
  if (install.phase === 'downloading') {
    const value = percent(install)
    const received = install.progress?.received ?? 0
    return (
      <span className="cg-inline cg-update-progress" role="status">
        <progress max={100} value={value ?? undefined} aria-label="Güncelleme indiriliyor" />
        <span className="cg-help mono">{value !== null ? `%${value}` : formatFileSize(received)}</span>
      </span>
    )
  }
  if (install.phase === 'ready' || install.phase === 'restarting') {
    return (
      <button className={`cg-btn cg-btn-primary${size}`} disabled={install.phase === 'restarting'} onClick={onRestart}>
        {install.phase === 'restarting' ? 'Yeniden başlatılıyor…' : 'Yeniden başlat ve güncelle'}
      </button>
    )
  }
  return (
    <>
      <button className={`cg-btn cg-btn-primary${size}`} onClick={onInstall}>{info.latest} sürümünü kur</button>
      {install.phase === 'error' && <span className="cg-help error" role="alert">{install.error}</span>}
      {install.phase === 'error' && pageButton}
    </>
  )
}
