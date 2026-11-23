import React, { createContext, useContext } from 'react';

// As telas de gestão de empresas servem a dois painéis: o do Dono (/dono) e o
// da Agência (/agencia). O escopo diz em qual painel a tela está.
export type PanelKind = 'owner' | 'agency';

export interface PanelScope {
  kind: PanelKind;
  base: string;
  title: string;
}

const SCOPES: Record<PanelKind, PanelScope> = {
  owner: { kind: 'owner', base: '/dono', title: 'Painel do Dono' },
  agency: { kind: 'agency', base: '/agencia', title: 'Painel da Agência' },
};

const PanelScopeContext = createContext<PanelScope>(SCOPES.owner);

export const PanelScopeProvider: React.FC<{ kind: PanelKind; children: React.ReactNode }> = ({ kind, children }) => (
  <PanelScopeContext.Provider value={SCOPES[kind]}>{children}</PanelScopeContext.Provider>
);

export const usePanel = () => useContext(PanelScopeContext);

// Link para uma aba da empresa conforme o tipo de alerta
export const clinicPathForAlert = (base: string, orgId: string, kind: string) =>
  `${base}/clinicas/${orgId}${kind.startsWith('billing') ? '/cobranca' : kind === 'whatsapp_pending' || kind === 'send_failures' ? '/whatsapp' : ''}`;
