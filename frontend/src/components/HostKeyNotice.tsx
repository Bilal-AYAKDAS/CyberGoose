import type { HostKeyInfo } from '../services/apiClient'
import { Notice } from './Notice'

type HostKeyNoticeProps = {
  info: HostKeyInfo
  onTrust: () => void
  onCancel?: () => void
}

/**
 * SFTP/SSH sunucusu ilk kez görüldüğünde parmak izini gösterir. Kullanıcı, sunucu yöneticisinden
 * aldığı parmak iziyle karşılaştırıp onaylamalıdır; onaylanan anahtar known_hosts'a yazılır.
 */
export function HostKeyNotice({ info, onTrust, onCancel }: HostKeyNoticeProps) {
  return (
    <Notice
      title={`${info.host} sunucusu ilk kez görülüyor`}
      action={(
        <span className="cg-notice-actions">
          {onCancel && <button className="cg-btn cg-btn-ghost cg-btn-sm" onClick={onCancel}>Vazgeç</button>}
          <button className="cg-btn cg-btn-sm" onClick={onTrust}>Güven ve bağlan</button>
        </span>
      )}
    >
      Bu parmak izini sunucu yöneticisinden aldığınız değerle karşılaştırın.
      <code className="cg-fingerprint">{info.type} {info.fingerprint}</code>
    </Notice>
  )
}
