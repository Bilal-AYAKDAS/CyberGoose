import type { FileEntry } from '../types'

type FileTableProps = {
  entries: FileEntry[]
  selected: string | null
  onSelect: (entry: FileEntry) => void
}

export function FileTable({ entries, selected, onSelect }: FileTableProps) {
  return (
    <div className="file-table">
      <div className="file-row file-header">
        <span>Ad</span><span>Değiştirilme</span><span>Boyut</span>
      </div>
      {entries.map((entry) => (
        <button
          className={`file-row ${selected === entry.name ? 'selected' : ''}`}
          key={entry.name}
          onClick={() => onSelect(entry)}
        >
          <span className="file-name">
            <span className={`file-icon ${entry.kind}`}>{entry.kind === 'folder' ? '▰' : '▱'}</span>
            {entry.name}
          </span>
          <span>{entry.modified}</span>
          <span>{entry.size}</span>
        </button>
      ))}
    </div>
  )
}
