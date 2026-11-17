import type { ReactNode } from 'react'
import type { ThemePreference } from '../hooks/useTheme'
import type { AppSettings } from '../hooks/useSettings'
import { Modal } from './Modal'

type SettingsModalProps = {
  themePreference: ThemePreference
  onThemeChange: (next: ThemePreference) => void
  settings: AppSettings
  onChange: (next: AppSettings) => void
  onClose: () => void
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

export function SettingsModal({ themePreference, onThemeChange, settings, onChange, onClose }: SettingsModalProps) {
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
          options={[{ value: 'ask', label: 'Her zaman sor' }, { value: 'overwrite', label: 'Üzerine yaz' }]}
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
      </div>
    </Modal>
  )
}
