import React, { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

interface LogoUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}

const MAX_BYTES = 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Logo da própria empresa: vai para brand-assets/org/<empresa>/ (só o admin envia). */
export const LogoUpload: React.FC<LogoUploadProps> = ({ value, onChange, disabled }) => {
  const { organization } = useOrganization();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!TYPES.includes(file.type)) {
      toast.error('Use uma imagem PNG, JPG, WEBP ou SVG');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('A imagem precisa ter até 1 MB');
      return;
    }
    if (!organization?.id) {
      toast.error('Empresa não encontrada. Entre de novo e tente outra vez.');
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `org/${organization.id}/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('brand-assets').upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from('brand-assets').getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success('Logo enviado');
    } catch (err: any) {
      console.error('[LogoUpload]', err);
      toast.error('Não foi possível enviar o logo' + (err?.message ? `: ${err.message}` : ''));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-4" data-testid="logo-upload">
      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-secondary/30">
        {value ? (
          <img src={value} alt="Logo da empresa" className="h-full w-full object-contain" />
        ) : (
          <ImagePlus className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {value ? 'Trocar logo' : 'Enviar logo'}
          </button>
          {value && (
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:text-destructive disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Remover
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPG, WEBP ou SVG até 1 MB. Aparece no menu do sistema.</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={TYPES.join(',')}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
};

export default LogoUpload;
