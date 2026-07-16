import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

// Catches render-time errors so a single component failure shows a friendly
// fallback (with reload) instead of an unresponsive black/white window.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info)
    try {
      const msg = `RENDER ERROR: ${error.name}: ${error.message}\nSTACK: ${error.stack ?? ''}\nCOMPONENT: ${info.componentStack ?? ''}`
      window.api?.logRendererError?.(msg)
    } catch { /* ignore logging failure */ }
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error) {
      const err = this.state.error
      const detail = `${err.name}: ${err.message}\n\n${err.stack ?? ''}`
      return (
        <div className="h-full w-full overflow-auto bg-surface text-muted-light p-8">
          <div className="max-w-2xl mx-auto">
            <p className="text-base font-semibold mb-2 text-red-400">界面出现了一个错误</p>
            <p className="text-xs text-muted-light mb-3">
              已将错误详情显示在下方，点击「复制错误」把内容发给我即可精准定位。
              点击下方按钮重新加载通常可以解决问题。
            </p>
            <pre className="text-[11px] leading-relaxed bg-surface-panel border border-surface-border rounded-lg p-3 mb-3 whitespace-pre-wrap break-words text-amber-300 max-h-60 overflow-auto">{detail}</pre>
            <div className="flex gap-2">
              <button
                onClick={() => { try { navigator.clipboard?.writeText(detail) } catch { /* ignore */ } }}
                className="px-4 py-2 bg-surface-card border border-surface-border text-muted-light text-xs rounded hover:bg-surface-hover"
              >
                复制错误
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 bg-accent text-white text-xs rounded hover:bg-accent/80"
              >
                重新加载
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
