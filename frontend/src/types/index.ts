export type EntryKind = 'folder' | 'file'

export type FileEntry = {
  name: string
  kind: EntryKind
  size: string
  modified: string
  path?: string
  permissions?: string
  hash?: string
  preview?: string
}

export type FileInspection = {
  FileName: string
  FilePath: string
  Type: string
  Size: number
  Change: string
  filemod: string
  sha256: string
  preview: string | null
  previewTruncated: boolean
}

export type ConnectionType = 'FTP' | 'SFTP' | 'S3' | 'Dropbox' | 'GoogleDrive'

export type ConnectionProfile = {
  id: string
  name: string
  type: ConnectionType
  host: string
  port: string
  username: string
  path: string
  status: 'connected' | 'offline' | 'unknown'
}

export type Bookmark = {
  id: string
  name: string
  connectionId: string
  path: string
  type: 'connection' | 'directory'
}

export type TransferStatus = 'queued' | 'transferring' | 'completed' | 'error' | 'cancelled'

export type TransferItem = {
  id: string
  name: string
  direction: 'upload' | 'download'
  size: string
  progress: number
  status: TransferStatus
  error?: string
}

export type ConnectionFormValues = Omit<ConnectionProfile, 'id' | 'status'>
