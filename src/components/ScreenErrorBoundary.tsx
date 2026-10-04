import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface State {
  error: Error | null;
}

// Se uma tela quebrar, mostra o erro e um botão de recarregar em vez de uma
// tela vazia. Use com key={location.pathname} para limpar ao trocar de tela.
class ScreenErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ScreenErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card/60 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <h2 className="text-xl font-bold tracking-tight">Esta tela encontrou um erro</h2>
          <p className="text-sm text-muted-foreground">
            Recarregue a página. Se continuar, envie a mensagem abaixo para o suporte.
          </p>
          <code className="w-full overflow-x-auto rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
            {this.state.error.message}
          </code>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}

export default ScreenErrorBoundary;
