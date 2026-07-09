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
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="h-full w-full flex items-center justify-center bg-[#1a1a18] text-[#b8b8b4] p-8">
          <div className="max-w-md text-center">
            <p className="text-sm font-medium mb-2">界面出现了一个错误</p>
            <p className="text-xs text-[#6a6a64] mb-4 break-words">{this.state.error.message}</p>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 bg-accent text-white text-xs rounded hover:bg-accent/80"
            >
              重新加载
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
