import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[FLD:Error] Uncaught error:', error, info.componentStack)
  }

  handleTryAgain = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] px-4 text-center">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 max-w-md w-full">
            <div className="text-4xl mb-4">&#9888;&#65039;</div>
            <h2 className="text-xl font-semibold text-slate-100 mb-2">Something went wrong</h2>
            <p className="text-slate-400 text-sm mb-6">
              An unexpected error occurred. You can try again or head back to the home page.
            </p>
            {this.state.error && (
              <pre className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-slate-400 text-left overflow-auto mb-6 max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleTryAgain}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Try again
              </button>
              <a
                href="/"
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-lg transition-colors"
              >
                Go home
              </a>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
