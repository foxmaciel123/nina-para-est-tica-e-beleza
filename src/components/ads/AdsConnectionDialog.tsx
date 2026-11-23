import React, { useEffect, useState } from 'react';
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '../Button';
import { db } from '../outbound/useOutbound';

export type AdsConnection = {
  ad_account_id: string | null;
  has_token: boolean;
  capi_enabled: boolean;
  capi_dataset_id: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  has_ctwa_whatsapp: boolean;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: AdsConnection | null;
  isAdmin: boolean;
  onSaved: () => void;
}

const AdsConnectionDialog: React.FC<Props> = ({ open, onOpenChange, connection, isAdmin, onSaved }) => {
  const [account, setAccount] = useState('');
  const [token, setToken] = useState('');
  const [capi, setCapi] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAccount(connection?.ad_account_id ?? '');
    setToken('');
    setCapi(connection?.capi_enabled ?? false);
  }, [open, connection]);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await db.rpc('ads_save_connection', {
        p_ad_account_id: account,
        p_access_token: token || null,
        p_capi_enabled: capi,
      });
      if (error) throw error;

      // Confere a chave na hora e já busca o investimento
      const { data: test } = await db.functions.invoke('meta-ads-sync', { body: { action: 'test' } });
      if (test?.ok) {
        toast.success(`Conta conectada: ${test.account?.name ?? account}. Buscando investimento...`);
        const { data: sync } = await db.functions.invoke('meta-ads-sync', { body: { action: 'sync' } });
        if (sync?.error) toast.warning(sync.error);
      } else if (test?.error) {
        toast.error(test.error);
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Não foi possível salvar');
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    const { error } = await db.rpc('ads_disconnect');
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Conta de anúncios desconectada');
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conta de anúncios da Meta</DialogTitle>
          <DialogDescription>
            Só leitura: a Nina lê o investimento e os nomes das campanhas. Ela nunca cria, pausa nem muda anúncios.
          </DialogDescription>
        </DialogHeader>

        {!isAdmin ? (
          <p className="text-sm text-muted-foreground">Só a administradora da clínica pode conectar a conta de anúncios.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ads-account">ID da conta de anúncios</Label>
              <Input
                id="ads-account"
                placeholder="Ex.: 1234567890 (com ou sem act_)"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                No Gerenciador de Anúncios, é o número que aparece ao lado do nome da conta (ou na barra de endereço: act=...).
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ads-token">Chave de acesso (token) com permissão ads_read</Label>
              <Input
                id="ads-token"
                type="password"
                autoComplete="off"
                placeholder={connection?.has_token ? 'Chave salva. Deixe vazio para manter.' : 'Cole a chave aqui'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Recomendado: usuário do sistema no Gerenciador de Negócios com acesso à conta e permissão ads_read (a chave não vence).
                {' '}
                <a
                  className="inline-flex items-center gap-1 text-primary underline"
                  href="https://business.facebook.com/settings/system-users"
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir usuários do sistema <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
              <div>
                <p className="text-sm font-medium">Devolver vendas para a Meta</p>
                <p className="text-xs text-muted-foreground">
                  Cada venda de cliente que veio de anúncio vai para a Meta como "Compra", com o valor. A Meta aprende quem compra
                  e otimiza melhor. Precisa do WhatsApp na API oficial e da permissão whatsapp_business_manage_events aprovada no app.
                </p>
                {!connection?.has_ctwa_whatsapp && (
                  <p className="mt-1 text-xs text-amber-400">Esta clínica ainda não está na API oficial do WhatsApp.</p>
                )}
              </div>
              <Switch checked={capi} onCheckedChange={setCapi} aria-label="Devolver vendas para a Meta" />
            </div>

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> A chave fica guardada só no servidor e nunca aparece de novo na tela.
            </p>

            <div className="flex justify-between gap-2 pt-2">
              {connection?.ad_account_id || connection?.has_token ? (
                <Button variant="ghost" size="sm" onClick={disconnect} disabled={saving}>Desconectar</Button>
              ) : <span />}
              <Button onClick={save} disabled={saving || (!account.trim() && !capi)}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar e testar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AdsConnectionDialog;
