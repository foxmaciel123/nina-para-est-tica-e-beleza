import React, { useState } from 'react';
import { LayoutDashboard, MessageSquare, Settings as SettingsIcon, LogOut, ShieldCheck, Calendar, Kanban, Sparkles, Crown, AlertCircle, Send, Repeat, Megaphone } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import { Sidebar, SidebarBody, SidebarLink, useSidebar } from '@/components/ui/sidebar';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useBrand } from '@/hooks/useBrand';
import { BrandIcon } from '@/components/BrandMark';
import ThemeToggle from './ThemeToggle';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';

const menuItems = [
  { id: 'dashboard', label: 'Visão Geral', icon: LayoutDashboard },
  { id: 'pipeline', label: 'Funil de Clientes', icon: Kanban },
  { id: 'chat', label: 'Atendimento', icon: MessageSquare },
  { id: 'contacts', label: 'Clientes', icon: Sparkles },
  { id: 'scheduling', label: 'Agenda', icon: Calendar },
  { id: 'team', label: 'Profissionais', icon: ShieldCheck },
  // Só o nome DISPARO fica em amarelo, para destacar
  { id: 'disparo', label: 'DISPARO', icon: Send, labelClassName: 'text-yellow-400 font-bold tracking-wide group-hover/sidebar:text-yellow-300' },
  { id: 'follow-up', label: 'Follow-up', icon: Repeat },
  { id: 'anuncios', label: 'Anúncios', icon: Megaphone },
  { id: 'settings', label: 'Configurações', icon: SettingsIcon },
];

const Logo = ({ companyName }: { companyName: string }) => {
  const { brand } = useBrand();
  return (
    <Link to="/dashboard" className="flex items-center space-x-3 py-1">
      <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
        <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
        <BrandIcon className="relative w-10 h-10" />
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col overflow-hidden"
      >
        <span className="font-bold text-lg tracking-tight text-foreground whitespace-nowrap">{companyName || 'Sua Clínica'}</span>
        <span className="text-[10px] uppercase tracking-wider text-primary font-semibold" data-testid="brand-name">{brand.name}</span>
      </motion.div>
    </Link>
  );
};

const LogoIcon = () => {
  return (
    <Link to="/dashboard" className="flex items-center py-1">
      <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
        <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
        <BrandIcon className="relative w-10 h-10" />
      </div>
    </Link>
  );
};

// Aviso discreto no menu: a Configuração Inicial só abre quando clicam aqui
const SetupPendingLink = ({ onClick }: { onClick: () => void }) => {
  const { open } = useSidebar();
  const { loading, requiredComplete, steps } = useOnboardingStatus();
  if (loading || requiredComplete) return null;
  const missing = steps.filter(s => s.isRequired && !s.isComplete).length;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="setup-pending"
      title="Configuração pendente: clique para continuar"
      className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-left text-amber-400 transition-colors hover:bg-amber-500/20"
    >
      <span className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
        <AlertCircle className="h-5 w-5" />
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />
      </span>
      {open && (
        <span className="flex flex-col overflow-hidden">
          <span className="text-sm font-medium whitespace-nowrap">Configuração pendente</span>
          <span className="text-[11px] text-amber-400/80 whitespace-nowrap">
            {missing} {missing === 1 ? 'passo falta' : 'passos faltam'}
          </span>
        </span>
      )}
    </button>
  );
};

const SidebarContent = ({ onOpenOnboarding }: { onOpenOnboarding?: () => void }) => {
  const { companyName } = useCompanySettings();
  const { user, signOut } = useAuth();
  const { isPlatformOwner } = useOrganization();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname.substring(1) || 'dashboard';
  const { open } = useSidebar();
  const { brand } = useBrand();

  const links = menuItems.map(item => ({
    label: item.label,
    href: `/${item.id}`,
    icon: <item.icon className="h-5 w-5" />,
    labelClassName: 'labelClassName' in item ? item.labelClassName : undefined,
  }));

  const handleLogout = async () => {
    try {
      await signOut();
      toast.success('Logout realizado com sucesso');
      navigate('/auth', { replace: true });
    } catch (error) {
      toast.error('Erro ao fazer logout');
    }
  };

  const getUserInitials = () => {
    if (!user?.email) return '?';
    const email = user.email;
    return email.substring(0, 2).toUpperCase();
  };

  const getDisplayName = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name;
    }
    return 'Você';
  };

  return (
    <>
      <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mb-6">
          {open ? <Logo companyName={companyName} /> : <LogoIcon />}
        </div>

        <nav className="flex flex-col gap-1.5" data-testid="sidebar-nav">
          {links.map((link, idx) => (
            <SidebarLink
              key={idx}
              link={link}
              labelClassName={link.labelClassName}
              isActive={currentPath.startsWith(link.href.slice(1))}
            />
          ))}
        </nav>

        {onOpenOnboarding && <SetupPendingLink onClick={onOpenOnboarding} />}

        {isPlatformOwner && (
          <nav className="mt-6 flex flex-col gap-1.5 border-t border-border/50 pt-4" data-testid="owner-nav">
            {open && (
              <span className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">Plataforma</span>
            )}
            <SidebarLink
              link={{ label: 'Painel do Dono', href: '/dono', icon: <Crown className="h-5 w-5" /> }}
              isActive={currentPath.startsWith('dono')}
            />
          </nav>
        )}
      </div>

      {open && brand.logo_url && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="py-4 flex justify-center"
        >
          <img
            src={brand.logo_url}
            alt={brand.name}
            className="h-7 opacity-70 hover:opacity-100 transition-opacity"
          />
        </motion.div>
      )}

      <div className="border-t border-border/50 pt-4 space-y-3">
        {open && (
          <div className="flex items-center justify-between px-2">
            <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Tema</span>
            <ThemeToggle />
          </div>
        )}
        {!open && (
          <div className="flex justify-center">
            <ThemeToggle />
          </div>
        )}
        <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-secondary/50 transition-colors cursor-pointer group">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-primary/20 to-accent/30 flex items-center justify-center text-xs font-bold text-primary border border-border ring-2 ring-transparent group-hover:ring-primary/30 transition-all flex-shrink-0">
            {getUserInitials()}
          </div>
          <motion.div
            animate={{
              display: open ? "block" : "none",
              opacity: open ? 1 : 0,
            }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-hidden"
          >
            <p className="text-sm font-medium text-foreground group-hover:text-foreground whitespace-nowrap">{getDisplayName()}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email || 'voce@suaclinica.com.br'}</p>
          </motion.div>
          <motion.div
            animate={{
              display: open ? "block" : "none",
              opacity: open ? 1 : 0,
            }}
            transition={{ duration: 0.2 }}
          >
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors"
              title="Sair"
            >
              <LogOut className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
            </button>
          </motion.div>
        </div>
      </div>
    </>
  );
};

const AppSidebar: React.FC<{ onOpenOnboarding?: () => void }> = ({ onOpenOnboarding }) => {
  const [open, setOpen] = useState(true);

  return (
    <Sidebar open={open} setOpen={setOpen}>
      <SidebarBody className="justify-between gap-10 bg-card/50 backdrop-blur-xl border-r border-border/50">
        <SidebarContent onOpenOnboarding={onOpenOnboarding} />
      </SidebarBody>
    </Sidebar>
  );
};

export default AppSidebar;
