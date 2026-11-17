import { Component, type ReactNode } from 'react'
import { Notice } from './Notice'

type ChunkBoundaryProps = { children: ReactNode; onReset?: () => void }
type ChunkBoundaryState = { failed: boolean }

/**
 * Ayrı yüklenen (lazy) bir parça açılamazsa bütün pencere boşalmasın: yalnızca o katman yerine
 * bir uyarı gösterilir. Kapatınca katman kapanır ve sonraki açılışta yeniden denenir.
 */
export class ChunkBoundary extends Component<ChunkBoundaryProps, ChunkBoundaryState> {
  state: ChunkBoundaryState = { failed: false }

  static getDerivedStateFromError(): ChunkBoundaryState {
    return { failed: true }
  }

  reset = () => {
    this.setState({ failed: false })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="cg-chunk-error">
        <Notice
          tone="error"
          title="Bu bölüm yüklenemedi. Uygulamayı yeniden başlatıp tekrar deneyin."
          action={<button className="cg-btn cg-btn-sm" onClick={this.reset}>Kapat</button>}
        />
      </div>
    )
  }
}
