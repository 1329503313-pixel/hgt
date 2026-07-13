import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-page px-4">
          <div className="text-center">
            <div className="mb-3 text-4xl">🫗</div>
            <h2 className="mb-2 text-lg font-semibold text-ink">页面出错了</h2>
            <p className="mb-4 text-sm text-muted">请刷新页面重试，或联系管理员</p>
            <button
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white shadow-soft transition-colors hover:bg-primary/90"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
