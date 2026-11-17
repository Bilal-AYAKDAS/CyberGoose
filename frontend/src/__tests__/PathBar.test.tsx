import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PathBar } from '../components/PathBar'

afterEach(cleanup)

describe('PathBar', () => {
  it('renders drive selector and navigates when drive changes', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(
      <PathBar
        tag={<span>YEREL</span>}
        crumbs={[{ name: 'C:', path: 'C:\\' }]}
        path="C:\\Users"
        drives={['C:\\', 'D:\\']}
        onNavigate={onNavigate}
      />,
    )

    const select = screen.getByLabelText('Sürücü seç')
    await user.selectOptions(select, 'D:\\')
    expect(onNavigate).toHaveBeenCalledWith('D:\\')
  })
})
