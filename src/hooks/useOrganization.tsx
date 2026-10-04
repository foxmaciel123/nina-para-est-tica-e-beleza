import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface Organization {
  id: string;
  name: string;
  status: string;
  role: string;
}

interface OrganizationContextType {
  organization: Organization | null;
  isPlatformOwner: boolean;
  isSuspended: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export const OrganizationProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  // Depende só do id: o Supabase recria o objeto user a cada renovação de
  // token / volta à aba, e isso não pode recarregar a clínica nem as telas.
  const userId = user?.id ?? null;
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!userId) {
      setOrganization(null);
      setIsPlatformOwner(false);
      setLoadedFor(null);
      return;
    }

    const [orgResult, ownerResult] = await Promise.all([
      supabase.rpc('my_organization'),
      supabase.rpc('is_platform_owner'),
    ]);

    // Falha de rede numa atualização não derruba a clínica já carregada
    if (orgResult.error || ownerResult.error) {
      console.error('[useOrganization]', orgResult.error ?? ownerResult.error);
      setLoadedFor((prev) => (prev === userId ? prev : userId));
      return;
    }

    setOrganization(orgResult.data?.[0] ?? null);
    setIsPlatformOwner(ownerResult.data === true);
    setLoadedFor(userId);
  }, [userId]);

  useEffect(() => {
    if (!authLoading) refresh();
  }, [authLoading, refresh]);

  // Só mostra carregando na primeira vez para este usuário
  const loading = authLoading || loadedFor !== userId;

  return (
    <OrganizationContext.Provider
      value={{
        organization,
        isPlatformOwner,
        isSuspended: organization?.status === 'suspended',
        loading,
        refresh,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
};

export const useOrganization = () => {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
};
