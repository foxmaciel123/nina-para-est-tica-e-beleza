import React from 'react';
import { Navigate, Outlet, Link, useOutletContext } from 'react-router-dom';
import { Loader2, CirclePause, Building2 } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { useBrand } from '@/hooks/useBrand';

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

// Contato de suporte da marca (e-mail / WhatsApp), quando o dono preencheu
const SupportContact: React.FC = () => {
  const { brand } = useBrand();
  if (!brand.support_email && !brand.support_whatsapp) return null;
  const digits = brand.support_whatsapp?.replace(/D/g, '') ?? '';
  return (
    <p className="flex flex-wrap justify-center gap-x-4 gap-y-1" data-testid="support-contact">
      {brand.support_email && <a className="font-semibold text-accent hover:underline" href={`mailto:${brand.support_email}`}>{brand.support_email}</a>}
      {digits && <a className="font-semibold text-accent hover:underline" href={`https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`} target="_blank" rel="noreferrer">WhatsApp {brand.support_whatsapp}</a>}
    </p>
  );
};

// Telas da clínica: exige clínica vinculada e ativa.
// Repassa o contexto do AppLayout (setShowOnboarding etc.) para as telas filhas.
export const RequireClinic: React.FC = () => {
  const { organization, agency, isSuspended, isPlatformOwner, loading } = useOrganization();
  const layoutContext = useOutletContext();

  if (loading) return <FullLoader />;

  if (!organization) {
    if (isPlatformOwner) return <Navigate to="/dono" replace />;
    if (agency) return <Navigate to="/agencia" replace />;
    return (
      <Notice icon={<Building2 className="h-8 w-8 text-muted-foreground" />} title="Conta sem empresa">
        <p>Seu usuário ainda não está vinculado a nenhuma empresa. Peça para o suporte concluir o seu cadastro.</p>
        <SupportContact />
      </Notice>
    );
  }

  if (isSuspended) {
    return (
      <Notice icon={<CirclePause className="h-8 w-8 text-red-500" />} title="Acesso suspenso">
        <p>O acesso da <strong className="text-foreground">{organization.name}</strong> está suspenso e a assistente não está respondendo no WhatsApp.</p>
        <p>As mensagens das suas clientes continuam guardadas. Fale com o suporte para reativar.</p>
        <SupportContact />
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

// Painel da agência: exige agência ativa
export const RequireAgency: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { agency, loading } = useOrganization();
  if (loading) return <div className="h-screen"><FullLoader /></div>;
  if (!agency) return <Navigate to="/dashboard" replace />;
  if (agency.status !== 'active') {
    return (
      <div className="h-screen">
        <Notice icon={<CirclePause className="h-8 w-8 text-red-500" />} title="Acesso suspenso">
          <p>O acesso da <strong className="text-foreground">{agency.name}</strong> ao painel está suspenso.</p>
          <p>Fale com o suporte para reativar.</p>
          <SupportContact />
        </Notice>
      </div>
    );
  }
  return <>{children}</>;
};
