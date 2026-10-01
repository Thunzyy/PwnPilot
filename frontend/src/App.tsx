import "./index.css";
import { lazy, useEffect, type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./components/Layout/AppLayout";
import { useAuthStore } from "./stores/authStore";
import { AuthScreen } from "./components/Auth/AuthScreen";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LazyBoundary } from "./components/Layout/LazyBoundary";

const DashboardPage = lazy(async () => ({
  default: (await import("./pages/Dashboard")).Dashboard,
}));
const CommandLibraryPage = lazy(async () => ({
  default: (await import("./pages/CommandLibrary")).CommandLibraryPage,
}));
const CommandSettingsPage = lazy(async () => ({
  default: (await import("./pages/CommandSettings")).CommandSettingsPage,
}));
const ProjectViewPage = lazy(async () => ({
  default: (await import("./pages/ProjectView")).ProjectView,
}));
const SettingsPage = lazy(async () => ({
  default: (await import("./pages/Settings")).SettingsPage,
}));
const ProjectCommandSettingsPage = lazy(async () => ({
  default: (await import("./pages/ProjectCommandSettings"))
    .ProjectCommandSettingsPage,
}));
const ProjectSettingsPage = lazy(async () => ({
  default: (await import("./pages/ProjectSettings")).ProjectSettingsPage,
}));
const AIHubPage = lazy(async () => ({
  default: (await import("./pages/AIHub")).AIHubPage,
}));
const ReportsPage = lazy(async () => ({
  default: (await import("./pages/Reports")).ReportsPage,
}));
const KnowledgeBasePage = lazy(async () => ({
  default: (await import("./pages/KnowledgeBase")).KnowledgeBase,
}));
const KBSettingsPage = lazy(async () => ({
  default: (await import("./pages/KBSettings")).KBSettings,
}));

const ROUTE_FALLBACK_CLASS_NAME =
  "flex min-h-full items-center justify-center bg-[#0b0f17] text-sm text-slate-500";

const withLazyRoute = (node: ReactNode, fallbackLabel: string) => (
  <LazyBoundary
    fallbackLabel={fallbackLabel}
    fallbackClassName={ROUTE_FALLBACK_CLASS_NAME}
  >
    {node}
  </LazyBoundary>
);

function AppBootstrapScreen() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[#0b0f17] px-6 text-slate-200"
      data-testid="app-bootstrap-loading"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#252b3a] bg-[#121722] p-8 shadow-2xl">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="h-3 w-3 rounded-full bg-primary shadow-[0_0_18px_rgba(139,92,246,0.65)] animate-pulse"
          />
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Session bootstrap
          </p>
        </div>
        <h1 className="mt-4 text-2xl font-black tracking-tight text-white">
          Connecting to PwnPilot API…
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Checking your session and loading the workspace.
        </p>
      </div>
    </div>
  );
}

function App() {
  const { user, initialize, isLoading } = useAuthStore();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (isLoading) {
    return <AppBootstrapScreen />;
  }

  if (!user) {
    return <AuthScreen />;
  }

  const canAccessGlobalSettings = user.is_super_admin;

  return (
    <TooltipProvider delayDuration={300}>
      <AppLayout>
        <Routes>
          <Route
            path="/"
            element={withLazyRoute(<DashboardPage />, "Loading dashboard")}
          />
          <Route
            path="/commands"
            element={withLazyRoute(
              <CommandLibraryPage />,
              "Loading command library",
            )}
          />
          <Route
            path="/commands/settings"
            element={withLazyRoute(
              <CommandSettingsPage />,
              "Loading command settings",
            )}
          />
          <Route
            path="/ai"
            element={withLazyRoute(<AIHubPage />, "Loading AI hub")}
          />
          <Route
            path="/notes/settings"
            element={withLazyRoute(
              <KBSettingsPage />,
              "Loading knowledge base settings",
            )}
          />
          <Route
            path="/notes/:docId?"
            element={withLazyRoute(
              <KnowledgeBasePage />,
              "Loading knowledge base",
            )}
          />
          <Route
            path="/reports"
            element={withLazyRoute(<ReportsPage />, "Loading reports")}
          />
          <Route
            path="/settings"
            element={
              canAccessGlobalSettings
                ? withLazyRoute(<SettingsPage />, "Loading settings")
                : <Navigate to="/" replace />
            }
          />
          <Route
            path="/projects/:projectId/commands/settings"
            element={withLazyRoute(
              <ProjectCommandSettingsPage />,
              "Loading project command settings",
            )}
          />
          <Route
            path="/projects/:projectId/settings"
            element={withLazyRoute(
              <ProjectSettingsPage />,
              "Loading project settings",
            )}
          />
          <Route
            path="/projects/:projectId/:tab?"
            element={withLazyRoute(<ProjectViewPage />, "Loading project view")}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          className: 'bg-[#1a2030] border-[#252b3a] text-slate-200',
        }}
      />
    </TooltipProvider>
  );
}

export default App;
