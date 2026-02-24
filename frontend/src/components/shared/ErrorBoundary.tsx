import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Global Error Boundary
 * Catches unhandled React errors and shows a fallback UI instead of a white screen
 */

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // Log to external service in production (e.g. Sentry)
        console.error('[ErrorBoundary]', error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-xl border border-red-200 bg-red-50 p-8">
                    <div className="text-4xl">⚠️</div>
                    <h2 className="text-xl font-bold text-red-800">Something went wrong</h2>
                    <p className="max-w-md text-center text-sm text-red-600">
                        {this.state.error?.message || 'An unexpected error occurred.'}
                    </p>
                    <button
                        onClick={this.handleReset}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
