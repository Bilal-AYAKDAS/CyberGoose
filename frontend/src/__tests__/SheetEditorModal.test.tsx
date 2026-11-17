import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SheetEditorModal } from '../components/SheetEditorModal'
import { api } from '../services/apiClient'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SheetEditorModal', () => {
  it('loads xlsx sheets, edits cells, adds row, and saves', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'readSheet').mockResolvedValue({
      path: 'C:/rapor.xlsx',
      format: 'xlsx',
      sheets: [
        { name: 'Sayfa1', rows: [['Ad', 'Puan'], ['Ali', '10']] },
        { name: 'Sayfa2', rows: [['Not']] },
      ],
    })
    const writeSpy = vi.spyOn(api, 'writeSheet').mockResolvedValue({ path: 'C:/rapor.xlsx', size: 1234 })
    const onSaved = vi.fn()
    const onClose = vi.fn()

    render(<SheetEditorModal side="local" path="C:/rapor.xlsx" name="rapor.xlsx" onSaved={onSaved} onClose={onClose} />)
    const cellB2 = await screen.findByLabelText('Hücre B2')
    expect(cellB2).toHaveValue('10')

    await user.clear(cellB2)
    await user.type(cellB2, '99')
    await user.click(screen.getByRole('button', { name: '+ Satır ekle' }))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(writeSpy).toHaveBeenCalledWith(
      'local',
      'C:/rapor.xlsx',
      [
        { name: 'Sayfa1', rows: [['Ad', 'Puan'], ['Ali', '99'], ['', '']] },
        { name: 'Sayfa2', rows: [['Not']] },
      ],
      { delimiter: undefined, encoding: undefined, newline: undefined },
    )
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
