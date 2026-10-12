import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Lock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Destino do link de primeiro acesso (e de "Reenviar acesso") gerado pelo Painel do Dono.
// O supabase-js lê o token do #hash e abre a sessão; aqui a dona só cria a senha.
const linkError = (): string | null => {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const code = hash.get('error_code') || query.get('error_code') || hash.get('error') || query.get('error');
  if (!code) return null;
  return code.includes('expired') || code === 'access_denied'
    ? 'Este link expirou ou já foi usado. Peça um novo link de acesso para a Pixel Pro.'
    : 'Não foi possível validar este link. Peça um novo link de acesso para a Pixel Pro.';
};

const FirstAccess: React.FC = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [error] = useState<string | null>(linkError);
  const [waited, setWaited] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // O supabase-js pode levar um instante para trocar o #hash pela sessão
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setFormError('A senha precisa ter pelo menos 8 caracteres.');
    if (password !== confirm) return setFormError('As duas senhas não são iguais.');
    setFormError(null);
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setFormError(
        /different|same/i.test(updateError.message)
          ? 'Escolha uma senha diferente da anterior.'
          : 'Não foi possível salvar a senha. Peça um novo link de acesso.'
      );
      return;
    }
    toast.success('Senha criada. Bem-vinda!');
    navigate('/dashboard', { replace: true });
  };

  const invalid = error || (!loading && !user && waited);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-2xl border border-border bg-card/60 p-8 backdrop-blur-sm" data-testid="first-access">
        <div className="flex flex-col gap-1 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-accent">Nina Beleza · Estética com IA</p>
          <h1 className="text-2xl font-bold tracking-tight">Crie sua nova senha</h1>
          {user?.email && <p className="text-sm text-muted-foreground">Acesso de <strong className="text-foreground">{user.email}</strong></p>}
        </div>

        {invalid ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm text-muted-foreground">
              {error ?? 'Este link não é válido ou já foi usado. Peça um novo link de acesso para a Pixel Pro.'}
            </p>
            <button type="button" onClick={() => navigate('/auth')} className="text-sm font-semibold text-accent hover:underline">
              Já tenho senha, quero entrar
            </button>
          </div>
        ) : !user ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">Nova senha</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="new-password" type="password" autoComplete="new-password" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password">Repita a senha</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="confirm-password" type="password" autoComplete="new-password" className="pl-9" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </div>
            {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar senha e entrar
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default FirstAccess;
