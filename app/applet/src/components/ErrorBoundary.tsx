import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ShipWell Application Error Boundary caught:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      const errMessage = this.state.error?.message || "Unknown runtime error";
      const stack = this.state.error?.stack || "";
      const errorCode = `SW-ERR-${Math.abs(
        errMessage.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
      )
        .toString(36)
        .toUpperCase()}`;

      return (
        <div className="min-h-screen bg-[#07090F] text-[#F1F5F9] flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-[#111827] border border-[#1E293B] rounded-2xl p-8 shadow-2xl space-y-6">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white">
                  Something went wrong
                </h1>
                <p className="text-xs text-red-400 font-mono mt-0.5">
                  Error Code: {errorCode}
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              ShipWell encountered an unexpected issue while rendering this page. Your data is secure. Please refresh or return home.
            </p>

            <div className="bg-[#0A0D14] border border-[#1E293B] rounded-xl p-4 font-mono text-xs text-red-300 overflow-x-auto max-h-32">
              <p className="font-bold">{errMessage}</p>
              {stack && <p className="text-slate-500 text-[10px] mt-1 whitespace-pre-wrap">{stack.slice(0, 300)}</p>}
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/10"
              >
                <RefreshCw className="w-4 h-4 animate-spin-hover" />
                <span>Reload application</span>
              </button>
              <a
                href="/"
                className="bg-[#1E293B] hover:bg-[#2A374A] text-slate-200 font-medium py-3 px-4 rounded-xl transition-all flex items-center justify-center space-x-2"
              >
                <Home className="w-4 h-4" />
                <span>Home</span>
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
