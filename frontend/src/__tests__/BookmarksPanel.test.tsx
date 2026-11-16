import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookmarksPanel } from '../components/BookmarksPanel'

afterEach(cleanup)

describe('BookmarksPanel', () => {
  it('filters, adds, and deletes bookmarks', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(
      <BookmarksPanel
        bookmarks={[{ id: 1, name: 'Belgeler', connectionId: null, path: 'C:/Belgeler' }]}
        connections={[]}
        currentFolder={{ label: 'Projeler', path: 'C:/Projeler', connectionId: null }}
        onSelect={vi.fn()}
        onAdd={onAdd}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Bu klasörü ekle' }))
    expect(onAdd).toHaveBeenCalledTimes(1)

    await user.type(screen.getByLabelText('Yer imlerinde ara'), 'belge')
    expect(screen.getByText('Belgeler')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Belgeler yer imini sil' }))
    expect(onDelete).toHaveBeenCalledWith({ id: 1, name: 'Belgeler', connectionId: null, path: 'C:/Belgeler' })
  })
})
