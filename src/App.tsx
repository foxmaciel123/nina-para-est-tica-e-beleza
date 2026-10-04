import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import ScreenErrorBoundary from './components/ScreenErrorBoundary';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ChatInterface from './components/ChatInterface';
import Contacts from './components/Contacts';
import Settings from './components/Settings';
import Team from './components/Team';
import Scheduling from './components/Scheduling';
import Kanban from './components/Kanban';
import Auth from './pages/Auth';
import ProtectedRoute from './components/ProtectedRoute';
import { RequireClinic, RequireOwner } from './components/AccessGates';
import OwnerLayout from './components/owner/OwnerLayout';
import OwnerDashboard from './components/owner/OwnerDashboard';
import OwnerClinics from './components/owner/OwnerClinics';
import OwnerBilling from './components/owner/OwnerBilling';
import OwnerAiUsage from './components/owner/OwnerAiUsage';
import OwnerAlerts from './components/owner/OwnerAlerts';
import OwnerClinicLayout from './components/owner/clinic/OwnerClinicLayout';
import ClinicSummary from './components/owner/clinic/ClinicSummary';
import ClinicWhatsapp from './components/owner/clinic/ClinicWhatsapp';
import ClinicAgent from './components/owner/clinic/ClinicAgent';
import ClinicBilling from './components/owner/clinic/ClinicBilling';
import ClinicHours from './components/owner/clinic/ClinicHours';
import ClinicProcedures from './components/owner/clinic/ClinicProcedures';
import FirstAccess from './pages/FirstAccess';

import { CompanySettingsProvider } from './hooks/useCompanySettings';
import { AuthProvider } from './hooks/useAuth';
import { OrganizationProvider } from './hooks/useOrganization';
import { ThemeProvider, useTheme } from './hooks/useTheme';
import { Toaster } from 'sonner';
import { OnboardingWizard } from './components/OnboardingWizard';
import { useOnboardingStatus } from './hooks/useOnboardingStatus';

// Componente de Layout que envolve a aplicação principal
const AppLayout: React.FC = () => {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { isComplete, hasSeenWizard, loading } = useOnboardingStatus();
  const location = useLocation();

  // Show wizard automatically on first load if not complete and never seen
  useEffect(() => {
    if (!loading && !isComplete && !hasSeenWizard) {
      setShowOnboarding(true);
    }
  }, [loading, isComplete, hasSeenWizard]);

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[128px] pointer-events-none -translate-x-1/2 -translate-y-1/2 z-0"></div>
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-accent/10 rounded-full blur-[128px] pointer-events-none translate-x-1/2 translate-y-1/2 z-0"></div>
      
      <Sidebar />
      
      <main className="flex-1 h-full overflow-hidden relative z-10 flex flex-col">
        {/* Top Border Gradient */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-50 z-20"></div>
        
        <div className="flex-1 w-full h-full relative">
          <ScreenErrorBoundary key={location.pathname}>
            <Outlet context={{ showOnboarding, setShowOnboarding }} />
          </ScreenErrorBoundary>
        </div>
      </main>

      <OnboardingWizard 
        isOpen={showOnboarding} 
        onClose={() => setShowOnboarding(false)} 
      />
    </div>
  );
};

const ThemedToaster: React.FC = () => {
  const { theme } = useTheme();
  return <Toaster position="top-right" richColors theme={theme} />;
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <OrganizationProvider>
        <CompanySettingsProvider>
          <BrowserRouter>
            <Routes>
              {/* Public Routes */}
              <Route path="/auth" element={<Auth />} />
              <Route path="/primeiro-acesso" element={<FirstAccess />} />

              {/* Protected Routes (With Sidebar) */}
              <Route element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }>
                <Route element={<RequireClinic />}>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/pipeline" element={<Kanban />} />
                  <Route path="/chat" element={<ChatInterface />} />
                  <Route path="/contacts" element={<Contacts />} />
                  <Route path="/scheduling" element={<Scheduling />} />
                  <Route path="/team" element={<Team />} />
                  <Route path="/settings" element={<Settings />} />
                </Route>
              </Route>

              {/* Painel do Dono: moldura própria, separada do painel da clínica */}
              <Route element={<ProtectedRoute><RequireOwner><OwnerLayout /></RequireOwner></ProtectedRoute>}>
                <Route path="/dono" element={<Navigate to="/dono/dashboard" replace />} />
                <Route path="/dono/dashboard" element={<OwnerDashboard />} />
                <Route path="/dono/clinicas" element={<OwnerClinics />} />
                <Route path="/dono/vencimentos" element={<OwnerBilling />} />
                <Route path="/dono/consumo-ia" element={<OwnerAiUsage />} />
                <Route path="/dono/alertas" element={<OwnerAlerts />} />
              </Route>
              <Route path="/dono/clinicas/:id" element={<ProtectedRoute><RequireOwner><OwnerClinicLayout /></RequireOwner></ProtectedRoute>}>
                <Route index element={<ClinicSummary />} />
                <Route path="whatsapp" element={<ClinicWhatsapp />} />
                <Route path="agente-ia" element={<ClinicAgent />} />
                <Route path="horarios" element={<ClinicHours />} />
                <Route path="procedimentos" element={<ClinicProcedures />} />
                <Route path="cobranca" element={<ClinicBilling />} />
              </Route>

              {/* Catch all - redirect to dashboard */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
          <ThemedToaster />
        </CompanySettingsProvider>
        </OrganizationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
