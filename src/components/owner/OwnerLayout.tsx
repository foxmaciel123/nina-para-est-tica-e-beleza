import React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Building2, Wallet, Cpu, AlertTriangle, ArrowLeftRight, LogOut, Crown, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import ThemeToggle from '@/components/ThemeToggle';
import ScreenErrorBoundary from '@/components/ScreenErrorBoundary';
import { useBrand } from '@/hooks/useBrand';

export interface OwnerNavItem {
  label: string;
  to: string;
  icon: React.ElementType;
  end?: boolean;
}

export interface OwnerNavGroup {
  label: string;
  items: OwnerNavItem[];
}

const GROUPS: OwnerNavGroup[] = [
  {
    label: 'Visão',
    items: [
      { label: 'Dashboard', to: '/dono/dashboard', icon: LayoutDashboard },
      { label: 'Clínicas', to: '/dono/clinicas', icon: Building2 },
    ],
  },
  { label: 'Financeiro', items: [{ label: 'Vencimentos', to: '/dono/vencimentos', icon: Wallet }] },
  { label: 'IA', items: [{ label: 'Consumo de IA', to: '/dono/consumo-ia', icon: Cpu }] },
  {
    label: 'Sistema',
    items: [
      { label: 'Alertas', to: '/dono/alertas', icon: AlertTriangle },
      { label: 'Marca', to: '/dono/marca', icon: Palette },
    ],
  },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
    isActive ? 'bg-accent/15 font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
  }`;

// Moldura do Painel do Dono: menu lateral próprio, separado do painel da clínica.
// `header` e `groups` permitem reaproveitar a moldura na clínica aberta (abas).
export const OwnerFrame: React.FC<{
  header?: React.ReactNode;
  groups: OwnerNavGroup[];
  children: React.ReactNode;
}> = ({ header, groups, children }) => {
  const { user, signOut } = useAuth();
  const { organization } = useOrganization();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await signOut();
    toast.success('Você saiu da conta');
    navigate('/auth', { replace: true });
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground md:flex-row" data-testid="owner-shell">
      <aside className="flex flex-shrink-0 flex-col gap-4 border-b border-border/50 bg-card/50 p-3 md:w-60 md:border-b-0 md:border-r md:p-4">
        <div className="flex items-center gap-2.5 px-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Crown className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold">Painel do Dono</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="brand-name">{brand.name} · Plataforma</div>
          </div>
        </div>

        {header}

        <nav className="flex gap-1 overflow-x-auto md:flex-col md:gap-4 md:overflow-visible" aria-label="Menu do dono">
          {groups.map((group) => (
            <div key={group.label} className="flex gap-1 md:flex-col">
              <span className="hidden px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground md:block">
                {group.label}
              </span>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-3 md:mt-auto md:flex-col md:flex-nowrap md:items-stretch md:pt-4">
          {organization && (
            <NavLink
              to="/dashboard"
              className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/60"
              data-testid="switch-to-clinic"
            >
              <ArrowLeftRight className="h-4 w-4 text-accent" />
              Ir para minha clínica
            </NavLink>
          )}
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Tema</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-2 px-1">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Sair"
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="relative min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <ScreenErrorBoundary key={location.pathname}>{children}</ScreenErrorBoundary>
      </main>
    </div>
  );
};

const OwnerLayout: React.FC = () => (
  <OwnerFrame groups={GROUPS}>
    <Outlet />
  </OwnerFrame>
);

export default OwnerLayout;
