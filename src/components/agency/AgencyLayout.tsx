import React from 'react';
import { Outlet } from 'react-router-dom';
import { AlertTriangle, Building2, LayoutDashboard, Wallet } from 'lucide-react';
import { OwnerFrame, OwnerNavGroup } from '@/components/owner/OwnerLayout';

// Painel da Agência: mesma moldura do Painel do Dono, com o menu da agência.
// Marca da agência e fatura entram nas próximas partes.
const GROUPS: OwnerNavGroup[] = [
  {
    label: 'Visão',
    items: [
      { label: 'Visão geral', to: '/agencia/dashboard', icon: LayoutDashboard },
      { label: 'Empresas', to: '/agencia/clinicas', icon: Building2 },
      { label: 'Alertas', to: '/agencia/alertas', icon: AlertTriangle },
    ],
  },
  { label: 'Financeiro', items: [{ label: 'Mensalidades', to: '/agencia/mensalidades', icon: Wallet }] },
];

const AgencyLayout: React.FC = () => (
  <OwnerFrame groups={GROUPS}>
    <Outlet />
  </OwnerFrame>
);

export default AgencyLayout;
