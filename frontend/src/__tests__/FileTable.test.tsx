import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTable } from '../components/FileTable'
import type { FileEntry } from '../types'

const entries: FileEntry[] = [
  { name: 'Belgeler', kind: 'folder', size: null, modified: '2026-11-10T09:00:00', path: '/Belgeler', source: 'local' },
  { name: 'alpha.txt', kind: 'file', size: 100, modified: '2026-11-11T09:00:00', path: '/alpha.txt', source: 'local' },
  { name: 'beta.txt', kind: 'file', size: 300, modified: '2026-11-12T09:00:00', path: '/beta.txt', source: 'local' },
  { name: 'gamma.txt', kind: 'file', size: 200, modified: '2026-11-13T09:00:00', path: '/gamma.txt', source: 'local' },
]

afterEach(cleanup)

describe('FileTable', () => {
  it('sorts by size keeping folders first', async () => {
    const user = userEvent.setup()
    render(<FileTable label="Dosyalar" entries={entries} selected={[]} onSelect={vi.fn()} onOpen={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Boyut' }))
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Belgeler')).toBeInTheDocument()
    expect(within(rows[1]).getByText('alpha.txt')).toBeInTheDocument()
    expect(within(rows[2]).getByText('gamma.txt')).toBeInTheDocument()
    expect(within(rows[3]).getByText('beta.txt')).toBeInTheDocument()
  })

  it('supports Shift+Click range selection and Ctrl+A', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<FileTable label="Dosyalar" entries={entries} selected={[]} onSelect={onSelect} onOpen={vi.fn()} />)
    const row1 = screen.getByText('alpha.txt').closest('tr')!
    const row3 = screen.getByText('gamma.txt').closest('tr')!
    await user.click(row1)
    await user.keyboard('{Shift>}')
    await user.click(row3)
    await user.keyboard('{/Shift}')
    expect(onSelect).toHaveBeenLastCalledWith(['alpha.txt', 'beta.txt', 'gamma.txt'], entries[3])

    row1.focus()
    await user.keyboard('{Control>}a{/Control}')
    expect(onSelect).toHaveBeenLastCalledWith(['Belgeler', 'alpha.txt', 'beta.txt', 'gamma.txt'])
  })
})
