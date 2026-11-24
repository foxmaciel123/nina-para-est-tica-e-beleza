import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface CompanySettings {
  companyName: string;
  sdrName: string;
  /** id do nicho (src/niches/registry.ts); contas antigas = 'estetica' */
  businessNiche: string;
  /** logo da própria empresa (white label) */
  logoUrl: string | null;
  /** dá para desfazer a última troca de nicho? */
  canUndoNiche: boolean;
  previousNiche: string | null;
  loading: boolean;
  isAdmin: boolean;
  refetch: () => Promise<void>;
}

const CompanySettingsContext = createContext<CompanySettings | undefined>(undefined);

export const CompanySettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [companyName, setCompanyName] = useState('');
  const [sdrName, setSdrName] = useState('');
  const [businessNiche, setBusinessNiche] = useState('estetica');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [canUndoNiche, setCanUndoNiche] = useState(false);
  const [previousNiche, setPreviousNiche] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const { user } = useAuth();

  const fetchSettings = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // Check if user is admin
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();
      
      setIsAdmin(roleData?.role === 'admin');
      
      // Perfil da empresa (nome, assistente, nicho, logo). A função org_profile
      // funciona para qualquer membro; se o servidor ainda não tiver a função,
      // cai na vitrine antiga (nina_public_settings, só nome e assistente).
      type Profile = {
        company_name?: string | null;
        sdr_name?: string | null;
        business_niche?: string | null;
        company_logo_url?: string | null;
        can_undo_niche?: boolean | null;
        previous_niche?: string | null;
      };
      let profile: Profile | null = null;
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('org_profile');
      if (!rpcError && rpcData && typeof rpcData === 'object' && !Array.isArray(rpcData)) {
        profile = rpcData as Profile;
      } else {
        const { data, error } = await supabase
          .from('nina_public_settings' as any)
          .select('company_name, sdr_name')
          .limit(1)
          .maybeSingle();
        if (error && error.code !== 'PGRST116') {
          console.error('[useCompanySettings] Query error:', error);
          throw error;
        }
        profile = (data as unknown as Profile) ?? null;
      }

      // Sem configuração ainda: valores neutros (o admin preenche na Configuração Inicial)
      setCompanyName(profile?.company_name || 'Sua Empresa');
      setSdrName(profile?.sdr_name || 'Assistente');
      setBusinessNiche(profile?.business_niche || 'estetica');
      setLogoUrl(profile?.company_logo_url || null);
      setCanUndoNiche(!!profile?.can_undo_niche);
      setPreviousNiche(profile?.previous_niche || null);
    } catch (error) {
      console.error('[useCompanySettings] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [user]);

  const value: CompanySettings = {
    companyName,
    sdrName,
    businessNiche,
    logoUrl,
    canUndoNiche,
    previousNiche,
    loading,
    isAdmin,
    refetch: fetchSettings,
  };

  return (
    <CompanySettingsContext.Provider value={value}>
      {children}
    </CompanySettingsContext.Provider>
  );
};

export const useCompanySettings = () => {
  const context = useContext(CompanySettingsContext);
  if (context === undefined) {
    throw new Error('useCompanySettings must be used within a CompanySettingsProvider');
  }
  return context;
};
