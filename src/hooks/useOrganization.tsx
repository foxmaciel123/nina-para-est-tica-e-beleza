import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface Organization {
  id: string;
  name: string;
  status: string;
  role: string;
}

export interface Agency {
  id: string;
  name: string;
  status: string;
  role: string;
}

interface OrganizationContextType {
  organization: Organization | null;
  agency: Agency | null;
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
  const [agency, setAgency] = useState<Agency | null>(null);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!userId) {
      setOrganization(null);
      setAgency(null);
      setIsPlatformOwner(false);
      setLoadedFor(null);
      return;
    }

    const [orgResult, ownerResult, agencyResult] = await Promise.all([
      supabase.rpc('my_organization'),
      supabase.rpc('is_platform_owner'),
      supabase.rpc('my_agency' as any),
    ]);

    // Falha de rede numa atualização não derruba a clínica já carregada
    if (orgResult.error || ownerResult.error) {
      console.error('[useOrganization]', orgResult.error ?? ownerResult.error);
      setLoadedFor((prev) => (prev === userId ? prev : userId));
      return;
    }

    setOrganization(orgResult.data?.[0] ?? null);
    setIsPlatformOwner(ownerResult.data === true);
    const agencyRows = agencyResult.error ? null : (agencyResult.data as unknown as Agency[] | null);
    setAgency(Array.isArray(agencyRows) ? agencyRows[0] ?? null : null);
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
        agency,
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
