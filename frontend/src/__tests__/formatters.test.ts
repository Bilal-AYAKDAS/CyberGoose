import { describe, expect, it } from 'vitest'
import { connectionAddress, durationText, formatFileSize, formatRate } from '../utils/formatters'
import { connectionTone, queueSummary } from '../utils/status'
import type { ConnectionProfile, TransferItem } from '../types'

const sftp: ConnectionProfile = { id: '8', name: 'web-01', type: 'SFTP', host: '10.0.4.21', port: '22', username: 'deploy', hasPassword: false, saved: true }

describe('formatters', () => {
  it('formats sizes with decimal units like the design system', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(112)).toBe('112 B')
    expect(formatFileSize(6_800)).toBe('6.8 KB')
    expect(formatFileSize(184_200_000)).toBe('184.2 MB')
    expect(formatFileSize(null)).toBe('—')
    expect(formatRate(23_400_000)).toBe('23.4 MB/s')
  })

  it('shows user@host:port and never the password', () => {
    expect(connectionAddress(sftp, 'connected')).toBe('deploy@10.0.4.21:22')
    expect(connectionAddress({ ...sftp, type: 'Dropbox' }, 'offline')).toBe('Bağlı değil')
  })

  it('formats durations', () => {
    expect(durationText(2_400)).toBe('2 sn')
    expect(durationText(80_000)).toBe('1 dk 20 sn')
  })
})

describe('status helpers', () => {
  it('marks plain FTP with a warning dot', () => {
    expect(connectionTone('SFTP', 'connected')).toBe('ok')
    expect(connectionTone('FTP', 'connected')).toBe('warn')
    expect(connectionTone('SFTP', 'offline')).toBe('muted')
    expect(connectionTone('SFTP', 'error')).toBe('error')
  })

  it('counts active, queued and failed transfers', () => {
    const base: Omit<TransferItem, 'id' | 'status'> = { name: 'a', direction: 'upload', localDir: 'C:/', remoteDir: '/', sessionId: null, from: 'a', to: 'b', size: 1 }
    expect(queueSummary([
      { ...base, id: '1', status: 'transferring' },
      { ...base, id: '2', status: 'queued' },
      { ...base, id: '3', status: 'error' },
      { ...base, id: '4', status: 'completed' },
    ])).toEqual({ active: 1, queued: 1, errors: 1 })
  })
})
