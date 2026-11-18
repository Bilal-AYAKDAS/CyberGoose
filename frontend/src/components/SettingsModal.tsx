import type { ReactNode } from 'react'
import type { ThemePreference } from '../hooks/useTheme'
import type { AppSettings } from '../hooks/useSettings'
import type { InstallState, UpdateState } from '../hooks/useUpdateCheck'
import { UpdateActions } from './UpdateActions'
import { Modal } from './Modal'

type SettingsModalProps = {
  themePreference: ThemePreference
  onThemeChange: (next: ThemePreference) => void
  settings: AppSettings
  onChange: (next: AppSettings) => void
  onClose: () => void
  /** Güncelleme denetimi; yalnızca masaüstü uygulamasında verilir. */
  update?: {
    state: UpdateState
    onCheck: () => void
    onDownload: (url: string) => void
    /** Uygulama içinden kurulum (taşınabilir exe ya da kurulum dosyası); yoksa yalnızca indirme sayfası. */
    install?: { canInstall: boolean; state: InstallState; onInstall: () => void; onRestart: () => void }
  }
}

function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="cg-field wide">
      <span className="cg-field-label">{label}</span>
      <div className="cg-seg" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? 'is-on' : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <div className="cg-field wide">
      <label className="cg-check-row">
        <input type="checkbox" className="cg-check" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span>{children}</span>
      </label>
    </div>
  )
}

function UpdateSection({ update }: { update: NonNullable<SettingsModalProps['update']> }) {
  const { state, onCheck, onDownload, install } = update
  const info = state.info
  return (
    <div className="cg-field wide">
      <span className="cg-field-label">Güncellemeler</span>
      <div className="cg-inline">
        <button className="cg-btn" disabled={state.status === 'checking'} onClick={onCheck}>
          {state.status === 'checking' ? 'Denetleniyor…' : 'Güncellemeleri denetle'}
        </button>
        {info?.available && (
          <UpdateActions
            info={info}
            canInstall={Boolean(install?.canInstall)}
            install={install?.state ?? { phase: 'idle' }}
            onInstall={() => install?.onInstall()}
            onRestart={() => install?.onRestart()}
            onOpenPage={onDownload}
          />
        )}
      </div>
      {state.status === 'error' && <span className="cg-help error" role="alert">{state.error}</span>}
      {state.status !== 'error' && info && (
        <span className="cg-help">
          {info.available ? `Yeni sürüm var: ${info.latest} (kurulu: ${info.current})` : `CyberGoose güncel (${info.current}).`}
        </span>
      )}
    </div>
  )
}

export function SettingsModal({ themePreference, onThemeChange, settings, onChange, onClose, update }: SettingsModalProps) {
  return (
    <Modal
      title="Ayarlar"
      onClose={onClose}
      footer={<button className="cg-btn cg-btn-primary" onClick={onClose}>Tamam</button>}
    >
      <div className="body">
        <Segmented
          label="Tema"
          value={themePreference}
          options={[
            { value: 'system', label: 'Sistem' },
            { value: 'dark', label: 'Graphite (Koyu)' },
            { value: 'light', label: 'Paper (Açık)' },
          ]}
          onChange={onThemeChange}
        />
        <Segmented
          label="Tablo yoğunluğu"
          value={settings.density}
          options={[{ value: 'comfortable', label: 'Rahat' }, { value: 'compact', label: 'Sıkışık' }]}
          onChange={(density) => onChange({ ...settings, density })}
        />
        <Segmented
          label="Hedef dosya çakışması"
          value={settings.overwriteDefault}
          options={[
            { value: 'ask', label: 'Sor' },
            { value: 'overwrite', label: 'Üzerine yaz' },
            { value: 'newer', label: 'Daha yeniyse' },
            { value: 'skip', label: 'Atla' },
            { value: 'rename', label: 'Yeni adla' },
          ]}
          onChange={(overwriteDefault) => onChange({ ...settings, overwriteDefault })}
        />
        <Segmented
          label="Aynı anda aktarım"
          value={settings.maxParallel}
          options={[1, 2, 3, 4].map((value) => ({ value, label: String(value) }))}
          onChange={(maxParallel) => onChange({ ...settings, maxParallel })}
        />
        <Check checked={settings.showHidden} onChange={(showHidden) => onChange({ ...settings, showHidden })}>
          Gizli dosyaları göster (Ctrl+H)
        </Check>
        <Check checked={settings.notifications} onChange={(notifications) => onChange({ ...settings, notifications })}>
          Aktarımlar bitince masaüstü bildirimi göster
        </Check>
        <Check checked={settings.checkUpdates} onChange={(checkUpdates) => onChange({ ...settings, checkUpdates })}>
          Açılışta yeni sürümü denetle
        </Check>
        {update && <UpdateSection update={update} />}
      </div>
    </Modal>
  )
}
