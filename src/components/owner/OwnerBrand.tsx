import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBrand, type Brand } from '@/hooks/useBrand';
import { PageHeader, Panel } from './ownerUi';
import { rpcErrorMessage } from './ownerApi';

const MAX_BYTES = 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
const DEFAULT_ACCENT = '#0A4F95';

type ImageKind = 'logo' | 'icon';

async function uploadBrandImage(kind: ImageKind, file: File): Promise<string> {
  if (!ACCEPT.split(',').includes(file.type)) throw new Error('Use uma imagem PNG, JPG, WEBP ou SVG.');
  if (file.size > MAX_BYTES) throw new Error('A imagem precisa ter no máximo 1 MB.');
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `platform/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('brand-assets').upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw new Error('Não foi possível enviar a imagem. Tente de novo.');
  return supabase.storage.from('brand-assets').getPublicUrl(path).data.publicUrl;
}

const ImageField: React.FC<{
  kind: ImageKind;
  label: string;
  hint: string;
  value: string;
  onChange: (url: string) => void;
}> = ({ kind, label, hint, value, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      onChange(await uploadBrandImage(kind, file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar a imagem.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div className={`flex flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/40 ${kind === 'icon' ? 'h-14 w-14' : 'h-14 w-32'}`}>
          {value ? <img src={value} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {value ? 'Trocar' : 'Enviar imagem'}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')} aria-label={`Remover ${label.toLowerCase()}`}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" data-testid={`brand-${kind}-input`} onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
};

// Prévia de como a tela de entrada e o menu ficam com a marca escolhida
const BrandPreview: React.FC<{ form: Brand }> = ({ form }) => {
  const accent = form.accent_color || DEFAULT_ACCENT;
  const icon = form.icon_url ? (
    <img src={form.icon_url} alt="" className="h-full w-full object-cover" />
  ) : (
    <Sparkles className="h-1/2 w-1/2" />
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="brand-preview">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-5 text-center">
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl text-white" style={{ background: accent }}>{icon}</div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em]" style={{ color: accent }}>
          {form.name || 'Sua marca'}{form.tagline ? ` · ${form.tagline}` : ''}
        </p>
        <p className="text-lg font-bold">Bem-vinda de volta</p>
        <div className="mt-1 h-8 w-full rounded-md text-xs font-semibold leading-8 text-white" style={{ background: accent }}>Entrar</div>
        <p className="text-[10px] text-muted-foreground">Tela de entrada</p>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg text-white" style={{ background: accent }}>{icon}</div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold">Clínica Exemplo</p>
            <p className="truncate text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent }}>{form.name || 'Sua marca'}</p>
          </div>
        </div>
        {['Visão Geral', 'Atendimento', 'Agenda'].map((item, i) => (
          <div key={item} className="rounded-md px-2 py-1.5 text-xs" style={i === 0 ? { background: `${accent}26`, fontWeight: 600 } : undefined}>{item}</div>
        ))}
        {form.logo_url && <img src={form.logo_url} alt="" className="mx-auto mt-auto h-6 object-contain opacity-80" />}
        <p className="text-center text-[10px] text-muted-foreground">Menu da clínica</p>
      </div>
    </div>
  );
};

const OwnerBrand: React.FC = () => {
  const { brand, refresh } = useBrand();
  const [form, setForm] = useState<Brand>(brand);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => setForm(brand), [brand]);

  const set = <K extends keyof Brand>(key: K, value: Brand[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError('Informe o nome da marca.');
    setFormError(null);
    setSaving(true);
    const { error } = await supabase.rpc('owner_update_platform_brand' as any, {
      p_name: form.name,
      p_tagline: form.tagline ?? '',
      p_logo_url: form.logo_url ?? '',
      p_icon_url: form.icon_url ?? '',
      p_accent_color: form.accent_color ?? '',
      p_support_email: form.support_email ?? '',
      p_support_whatsapp: form.support_whatsapp ?? '',
    });
    setSaving(false);
    if (error) return setFormError(rpcErrorMessage(error, 'Não foi possível salvar. Tente de novo.'));
    toast.success('Marca salva');
    await refresh();
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6" data-testid="owner-brand">
      <PageHeader
        eyebrow="Sistema · Marca"
        title="Marca"
        description="Nome, imagens e cor que aparecem para as clínicas na tela de entrada, no menu e na aba do navegador."
      />

      <form onSubmit={save} noValidate className="flex flex-col gap-6">
        <Panel title="Identidade">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="brand-name">Nome da marca</Label>
              <Input id="brand-name" maxLength={60} value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="brand-tagline">Frase curta</Label>
              <Input id="brand-tagline" maxLength={80} placeholder="Ex.: Atendimento com IA para clínicas" value={form.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ImageField kind="icon" label="Ícone" hint="Quadrado, aparece no menu, na tela de entrada e na aba do navegador." value={form.icon_url ?? ''} onChange={(url) => set('icon_url', url)} />
            <ImageField kind="logo" label="Logo" hint="Horizontal, aparece no rodapé do menu da clínica. Opcional." value={form.logo_url ?? ''} onChange={(url) => set('logo_url', url)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="brand-color">Cor de destaque</Label>
            <div className="flex items-center gap-3">
              <input
                id="brand-color"
                type="color"
                value={form.accent_color || DEFAULT_ACCENT}
                onChange={(e) => set('accent_color', e.target.value.toUpperCase())}
                className="h-10 w-14 cursor-pointer rounded-md border border-border bg-transparent"
              />
              <span className="font-mono text-sm text-muted-foreground">{form.accent_color || DEFAULT_ACCENT}</span>
            </div>
          </div>
        </Panel>

        <Panel title="Suporte">
          <p className="text-sm text-muted-foreground">Contato que as clínicas veem quando precisam de ajuda. Opcional.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="brand-email">E-mail de suporte</Label>
              <Input id="brand-email" type="email" value={form.support_email ?? ''} onChange={(e) => set('support_email', e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="brand-whatsapp">WhatsApp de suporte</Label>
              <Input id="brand-whatsapp" inputMode="tel" placeholder="Ex.: 11 99999-9999" value={form.support_whatsapp ?? ''} onChange={(e) => set('support_whatsapp', e.target.value)} />
            </div>
          </div>
        </Panel>

        <Panel title="Prévia">
          <BrandPreview form={form} />
        </Panel>

        {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar marca
          </Button>
        </div>
      </form>
    </div>
  );
};

export default OwnerBrand;
