import { describe, expect, it } from 'vitest'
import { formatFileSize, joinRemotePath } from '../utils/formatters'

describe('formatters', () => {
  it('formats byte values for human-readable output', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('joins remote paths without duplicate separators', () => {
    expect(joinRemotePath('/var/www/', '/app')).toBe('/var/www/app')
    expect(joinRemotePath('', 'app')).toBe('/app')
  })
})
