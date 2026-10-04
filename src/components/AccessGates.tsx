import React from 'react';
import { Navigate, Outlet, Link, useOutletContext } from 'react-router-dom';
import { Loader2, CirclePause, Building2 } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';

const FullLoader = () => (
  <div className="flex h-full items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const Notice: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="flex h-full items-center justify-center bg-background p-6">
    <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card/60 p-8 text-center backdrop-blur-sm">
      {icon}
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 text-sm text-muted-foreground">{children}</div>
    </div>
  </div>
);

// Telas da clínica: exige clínica vinculada e ativa.
// Repassa o contexto do AppLayout (setShowOnboarding etc.) para as telas filhas.
export const RequireClinic: React.FC = () => {
  const { organization, isSuspended, isPlatformOwner, loading } = useOrganization();
  const layoutContext = useOutletContext();

  if (loading) return <FullLoader />;

  if (!organization) {
    if (isPlatformOwner) return <Navigate to="/dono" replace />;
    return (
      <Notice icon={<Building2 className="h-8 w-8 text-muted-foreground" />} title="Conta sem clínica">
        <p>Seu usuário ainda não está vinculado a nenhuma clínica. Peça para a Pixel Pro concluir o seu cadastro.</p>
      </Notice>
    );
  }

  if (isSuspended) {
    return (
      <Notice icon={<CirclePause className="h-8 w-8 text-red-500" />} title="Acesso suspenso">
        <p>O acesso da <strong className="text-foreground">{organization.name}</strong> está suspenso e a Nina não está respondendo no WhatsApp.</p>
        <p>As mensagens das suas clientes continuam guardadas. Fale com a Pixel Pro para reativar.</p>
        {isPlatformOwner && (
          <Link to="/dono" className="font-semibold text-accent hover:underline">Ir para o Painel do Dono</Link>
        )}
      </Notice>
    );
  }

  return <Outlet context={layoutContext} />;
};

// Telas do dono da plataforma (envolve a moldura própria do Painel do Dono)
export const RequireOwner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isPlatformOwner, loading } = useOrganization();
  if (loading) return <div className="h-screen"><FullLoader /></div>;
  if (!isPlatformOwner) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};
