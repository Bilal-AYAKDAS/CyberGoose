import { describe, expect, it } from 'vitest'
import { connectionAddress, formatFileSize, formatRate, joinRemotePath, splitPath } from '../utils/formatters'
import { connectionTone, queueSummary } from '../utils/status'
import type { ConnectionProfile } from '../types'

const sftp: ConnectionProfile = { id: 'a', name: 'web-01', type: 'SFTP', host: '10.0.4.21', port: '22', username: 'deploy', path: '/', status: 'connected' }

describe('formatters', () => {
  it('formats sizes with decimal units like the design system', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(112)).toBe('112 B')
    expect(formatFileSize(6_800)).toBe('6.8 KB')
    expect(formatFileSize(184_200_000)).toBe('184.2 MB')
    expect(formatFileSize(null)).toBe('—')
    expect(formatRate(23_400_000)).toBe('23.4 MB/s')
  })

  it('joins and splits paths', () => {
    expect(joinRemotePath('/var/www/', '/app')).toBe('/var/www/app')
    expect(joinRemotePath('', 'app')).toBe('/app')
    expect(splitPath('C:\\Users\\Bilal')).toEqual(['C:', 'Users', 'Bilal'])
    expect(splitPath('/var/www/html')).toEqual(['var', 'www', 'html'])
  })

  it('shows user@host:port and never the password', () => {
    expect(connectionAddress(sftp)).toBe('deploy@10.0.4.21:22')
  })
})

describe('status helpers', () => {
  it('marks plain FTP with a warning dot', () => {
    expect(connectionTone(sftp)).toBe('ok')
    expect(connectionTone({ ...sftp, type: 'FTP' })).toBe('warn')
    expect(connectionTone({ ...sftp, status: 'offline' })).toBe('muted')
    expect(connectionTone({ ...sftp, status: 'error' })).toBe('error')
  })

  it('counts active, queued and failed transfers', () => {
    const base = { name: 'a', direction: 'upload' as const, from: 'a', to: 'b', size: 1, progress: 0 }
    expect(queueSummary([
      { ...base, id: '1', status: 'transferring' },
      { ...base, id: '2', status: 'queued' },
      { ...base, id: '3', status: 'error' },
      { ...base, id: '4', status: 'completed' },
    ])).toEqual({ active: 1, queued: 1, errors: 1 })
  })
})
