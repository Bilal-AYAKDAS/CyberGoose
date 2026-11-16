import { Fragment, type ReactNode } from 'react'
import { Icon } from './Icon'

const MAX_VISIBLE_SEGMENTS = 4

type PathBarProps = {
  tag: ReactNode
  /** Her zaman görünen kök (host veya `~`). */
  root: string
  segments: string[]
  onRefresh?: () => void
}

/**
 * Panel yol çubuğu: protokol etiketi, chevron ile ayrılmış mono yol parçaları ve yenile.
 * Son parça text renginde/500 ağırlıkta; uzun yollar baştan kısalır, kök her zaman görünür.
 * Odaktaki panelin 2px turuncu üst çizgisi CSS'te `.cg-pane.is-focused .cg-pathbar` ile verilir.
 */
export function PathBar({ tag, root, segments, onRefresh }: PathBarProps) {
  const hidden = segments.length > MAX_VISIBLE_SEGMENTS
  const visible = hidden ? segments.slice(-MAX_VISIBLE_SEGMENTS + 1) : segments
  const parts = [root, ...(hidden ? ['…'] : []), ...visible]
  const fullPath = [root, ...segments].join('/')

  return (
    <div className="cg-pathbar">
      {tag}
      <div className="cg-crumbs" title={fullPath}>
        {parts.map((part, index) => (
          <Fragment key={`${part}-${index}`}>
            {index > 0 && <Icon name="chevron-right" size={12} />}
            {index === parts.length - 1 ? <b>{part}</b> : <span>{part}</span>}
          </Fragment>
        ))}
      </div>
      {onRefresh && (
        <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label="Paneli yenile" title="Yenile" onClick={onRefresh}>
          <Icon name="refresh" />
        </button>
      )}
    </div>
  )
}
