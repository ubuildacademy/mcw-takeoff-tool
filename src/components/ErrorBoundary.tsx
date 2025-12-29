import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Check if this is an expected error (like 404s) that we should ignore
    const isExpectedError = 
      error.message?.includes('404') ||
      error.message?.includes('Failed to load resource') ||
      error.message?.includes('MissingPDFException') ||
      error.name === 'MissingPDFException';
    
    if (isExpectedError) {
      // Log but don't show error boundary for expected errors
      console.warn('⚠️ Expected error caught (ignoring):', error.message);
      return;
    }
    
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });

    // Log to console with full details
    console.group('🚨 Error Boundary Caught Error');
    console.error('Error:', error);
    console.error('Error Info:', errorInfo);
    console.error('Component Stack:', errorInfo.componentStack);
    console.groupEnd();
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/app';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo } = this.state;
      const isDev = import.meta.env.DEV;

      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg border border-red-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
              <h1 className="text-2xl font-bold text-slate-900">
                Something went wrong
              </h1>
            </div>

            <p className="text-slate-600 mb-6">
              An unexpected error occurred. Please try refreshing the page or returning to the project list.
            </p>

            {isDev && error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <h2 className="text-sm font-semibold text-red-900 mb-2">
                  Error Details (Development Only):
                </h2>
                <pre className="text-xs text-red-800 overflow-auto max-h-64 whitespace-pre-wrap break-words">
                  {error.toString()}
                  {error.stack && `\n\nStack Trace:\n${error.stack}`}
                </pre>
                {errorInfo && (
                  <details className="mt-2">
                    <summary className="text-xs text-red-700 cursor-pointer hover:text-red-900">
                      Component Stack
                    </summary>
                    <pre className="text-xs text-red-800 mt-2 overflow-auto max-h-48 whitespace-pre-wrap break-words">
                      {errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                onClick={this.handleReset}
                variant="outline"
                className="flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </Button>
              <Button
                onClick={this.handleReload}
                variant="default"
                className="flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Page
              </Button>
              <Button
                onClick={this.handleGoHome}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Home className="w-4 h-4" />
                Back to Projects
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

