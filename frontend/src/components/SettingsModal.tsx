import type { Theme } from '../hooks/useTheme'
import type { AppSettings } from '../hooks/useSettings'
import { Modal } from './Modal'

type SettingsModalProps = {
  theme: Theme
  onToggleTheme: () => void
  settings: AppSettings
  onChange: (next: AppSettings) => void
  onClose: () => void
}

export function SettingsModal({ theme, onToggleTheme, settings, onChange, onClose }: SettingsModalProps) {
  return (
    <Modal
      title="Ayarlar"
      onClose={onClose}
      footer={<button className="cg-btn cg-btn-primary" onClick={onClose}>Tamam</button>}
    >
      <div className="body">
        <div className="cg-field wide">
          <span className="cg-field-label">Tema</span>
          <div className="cg-seg" role="radiogroup" aria-label="Tema seçimi">
            <button role="radio" aria-checked={theme === 'dark'} className={theme === 'dark' ? 'is-on' : undefined} onClick={() => { if (theme !== 'dark') onToggleTheme() }}>Graphite (Koyu)</button>
            <button role="radio" aria-checked={theme === 'light'} className={theme === 'light' ? 'is-on' : undefined} onClick={() => { if (theme !== 'light') onToggleTheme() }}>Paper (Açık)</button>
          </div>
        </div>

        <div className="cg-field wide">
          <span className="cg-field-label">Tablo yoğunluğu</span>
          <div className="cg-seg" role="radiogroup" aria-label="Tablo yoğunluğu">
            <button role="radio" aria-checked={settings.density === 'comfortable'} className={settings.density === 'comfortable' ? 'is-on' : undefined} onClick={() => onChange({ ...settings, density: 'comfortable' })}>Rahat (28px)</button>
            <button role="radio" aria-checked={settings.density === 'compact'} className={settings.density === 'compact' ? 'is-on' : undefined} onClick={() => onChange({ ...settings, density: 'compact' })}>Sıkışık (22px)</button>
          </div>
        </div>

        <div className="cg-field wide">
          <span className="cg-field-label">Hedef dosya çakışması</span>
          <div className="cg-seg" role="radiogroup" aria-label="Hedef dosya çakışması">
            <button role="radio" aria-checked={settings.overwriteDefault === 'ask'} className={settings.overwriteDefault === 'ask' ? 'is-on' : undefined} onClick={() => onChange({ ...settings, overwriteDefault: 'ask' })}>Her zaman sor</button>
            <button role="radio" aria-checked={settings.overwriteDefault === 'overwrite'} className={settings.overwriteDefault === 'overwrite' ? 'is-on' : undefined} onClick={() => onChange({ ...settings, overwriteDefault: 'overwrite' })}>Üzerine yaz</button>
          </div>
        </div>

        <div className="cg-field wide">
          <label className="cg-check-row">
            <input
              type="checkbox"
              className="cg-check"
              checked={settings.notifications}
              onChange={(event) => onChange({ ...settings, notifications: event.target.checked })}
            />
            <span>Aktarım tamamlandığında masaüstü bildirimi göster</span>
          </label>
        </div>
      </div>
    </Modal>
  )
}
