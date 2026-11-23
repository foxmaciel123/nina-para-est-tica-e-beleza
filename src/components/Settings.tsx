import React, { useRef, useState } from 'react';
import { Shield, Bot, Plug, Loader2, Save, RotateCcw, BookOpen, Lock, Sparkles, Calendar, Bell, Store } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import AgentSettings, { AgentSettingsRef } from './settings/AgentSettings';
import ApiSettings, { ApiSettingsRef } from './settings/ApiSettings';
import ProceduresManager from './settings/ProceduresManager';
import GoogleCalendarConnect from './settings/GoogleCalendarConnect';
import RemindersManager from './settings/RemindersManager';
import AppConfigCard from './settings/AppConfigCard';
import SystemRoadmap from './SystemRoadmap';
import BusinessSettings from './settings/BusinessSettings';
import { useNiche } from '@/hooks/useNiche';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { Button } from './Button';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useOutletContext } from 'react-router-dom';
import { useOrganization } from '@/hooks/useOrganization';

interface OutletContext {
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
}

const Settings: React.FC = () => {
  const { companyName, isAdmin } = useCompanySettings();
  // Documentação técnica só para o dono da plataforma (as clínicas não veem)
  const { isPlatformOwner } = useOrganization();
  const niche = useNiche();
  const t = niche.terms;
  const agentRef = useRef<AgentSettingsRef>(null);
  const apiRef = useRef<ApiSettingsRef>(null);
  const [activeTab, setActiveTab] = useState('agent');
  const { resetWizard } = useOnboardingStatus();
  const { setShowOnboarding } = useOutletContext<OutletContext>();

  const handleReopenOnboarding = () => {
    resetWizard();
    setShowOnboarding(true);
  };

  const handleSave = async () => {
    if (activeTab === 'agent') {
      await agentRef.current?.save();
    } else if (activeTab === 'apis') {
      await apiRef.current?.save();
    }
  };

  const handleCancel = () => {
    if (activeTab === 'agent') {
      agentRef.current?.cancel();
    } else if (activeTab === 'apis') {
      apiRef.current?.cancel();
    }
  };

  const isSaving = activeTab === 'agent' 
    ? agentRef.current?.isSaving 
    : apiRef.current?.isSaving;
  
  return (
    <div className="p-8 max-w-5xl mx-auto h-full overflow-y-auto bg-slate-950 text-slate-50 custom-scrollbar">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground" data-testid="settings-title">Configurações</h2>
          <p className="text-sm text-slate-400 mt-1">
            Ajuste como a assistente atende {t.clienteFeminino ? 'as' : 'os'} {t.clientes} de {companyName || 'sua empresa'}.
            {!isAdmin && (
              <span className="ml-2 text-amber-400">(Somente leitura)</span>
            )}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReopenOnboarding}
              className="text-slate-400 hover:text-foreground gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Refazer Onboarding
            </Button>
          )}
          <span className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs rounded-full font-mono flex items-center">
            {isAdmin ? (
              <>
                <Shield className="w-3 h-3 mr-1" /> Admin
              </>
            ) : (
              <>
                <Lock className="w-3 h-3 mr-1" /> Somente Leitura
              </>
            )}
          </span>
        </div>
      </div>

      <Tabs defaultValue="agent" className="w-full" onValueChange={setActiveTab}>
        <div className="flex items-center justify-between mb-8">
          <TabsList>
            <TabsTrigger value="business" className="gap-2">
              <Store className="w-4 h-4" />
              Seu negócio
            </TabsTrigger>
            <TabsTrigger value="agent" className="gap-2">
              <Bot className="w-4 h-4" />
              Agente
            </TabsTrigger>
            <TabsTrigger value="procedures" className="gap-2">
              <Sparkles className="w-4 h-4" />
              {t.catalogo}
            </TabsTrigger>
            <TabsTrigger value="apis" className="gap-2">
              <Plug className="w-4 h-4" />
              APIs
            </TabsTrigger>
            {niche.features.agenda && (
              <>
                <TabsTrigger value="calendar" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  Agenda
                </TabsTrigger>
                <TabsTrigger value="reminders" className="gap-2">
                  <Bell className="w-4 h-4" />
                  Lembretes
                </TabsTrigger>
              </>
            )}
            {isPlatformOwner && (
              <TabsTrigger value="docs" className="gap-2">
                <BookOpen className="w-4 h-4" />
                Documentação
              </TabsTrigger>
            )}
          </TabsList>

          {(activeTab === 'agent' || activeTab === 'apis') && isAdmin && (
            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={handleCancel}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={isSaving}
                className="gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Salvar Alterações
                  </>
                )}
              </Button>
            </div>
          )}
          
          {(activeTab === 'agent' || activeTab === 'apis') && !isAdmin && (
            <div className="flex items-center gap-2 text-sm text-amber-400">
              <Lock className="w-4 h-4" />
              Apenas administradores podem editar
            </div>
          )}
        </div>

        <TabsContent value="business">
          <BusinessSettings />
        </TabsContent>

        <TabsContent value="agent">
          <AgentSettings ref={agentRef} />
        </TabsContent>

        <TabsContent value="procedures">
          <ProceduresManager />
        </TabsContent>

        <TabsContent value="apis">
          <div className="space-y-6">
            <ApiSettings ref={apiRef} />
            <AppConfigCard />
          </div>
        </TabsContent>

        <TabsContent value="calendar">
          <GoogleCalendarConnect />
        </TabsContent>

        <TabsContent value="reminders">
          <RemindersManager />
        </TabsContent>

        {isPlatformOwner && (
          <TabsContent value="docs">
            <SystemRoadmap />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default Settings;
