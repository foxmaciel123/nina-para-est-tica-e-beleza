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
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setOrganization(null);
      setIsPlatformOwner(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [orgResult, ownerResult] = await Promise.all([
      supabase.rpc('my_organization'),
      supabase.rpc('is_platform_owner'),
    ]);

    if (orgResult.error) console.error('[useOrganization] my_organization:', orgResult.error);
    if (ownerResult.error) console.error('[useOrganization] is_platform_owner:', ownerResult.error);

    setOrganization(orgResult.data?.[0] ?? null);
    setIsPlatformOwner(ownerResult.data === true);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!authLoading) refresh();
  }, [authLoading, refresh]);

  return (
    <OrganizationContext.Provider
      value={{
        organization,
        isPlatformOwner,
        isSuspended: organization?.status === 'suspended',
        loading: authLoading || loading,
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
