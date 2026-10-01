import { ReactNode, useState, useEffect } from "react";
import {
  Bell,
  Settings,
  Activity,
  Search,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Terminal,
  Bot,
  FileText,
  BarChart3,
  Menu,
  X,
} from "lucide-react";
import { useNavigate, useLocation, NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HealthDiagnosticsPanel } from "@/components/Diagnostics/HealthDiagnosticsPanel";
import { useReportBadge } from "@/hooks/useReportBadge";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/projectStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppLayoutProps {
  children: ReactNode;
}

interface MobileNavControlsProps {
  initials: string;
  isSuperAdmin: boolean;
  navLinkClass: ({ isActive }: { isActive: boolean }) => string;
  onLogout: () => void;
  onNavigate: (path: string) => void;
  pendingReportCount: number;
  userEmail: string | null;
  userLabel: string;
}

const getInitials = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OP";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
};

const MAX_HEADER_VARIABLES = 4;
const MAX_HEADER_VARIABLE_PREVIEW = 40;

const isStructuredOrLargeValue = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 120) return true;
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return true;
  }
  return false;
};

const formatVariablePreview = (value: string) =>
  value.length > MAX_HEADER_VARIABLE_PREVIEW
    ? `${value.slice(0, MAX_HEADER_VARIABLE_PREVIEW - 3)}...`
    : value;

const isDisplayableVariable = (
  entry: [string, string | undefined]
): entry is [string, string] => {
  const [, value] = entry;
  return typeof value === "string" && !isStructuredOrLargeValue(value);
};

function MobileNavControls({
  initials,
  isSuperAdmin,
  navLinkClass,
  onLogout,
  onNavigate,
  pendingReportCount,
  userEmail,
  userLabel,
}: MobileNavControlsProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const showDevDiagnostics = import.meta.env.DEV;

  const closeMobileNav = () => {
    setMobileNavOpen(false);
  };

  const handleNavigate = (path: string) => {
    closeMobileNav();
    onNavigate(path);
  };

  return (
    <>
      <button
        type="button"
        aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={mobileNavOpen}
        aria-controls="mobile-nav"
        onClick={() => setMobileNavOpen((prev) => !prev)}
        className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-border-dark text-text-secondary hover:text-white hover:bg-white/[0.05] transition-colors"
      >
        {mobileNavOpen ? (
          <X className="h-4 w-4" />
        ) : (
          <Menu className="h-4 w-4" />
        )}
      </button>

      {mobileNavOpen && (
        <div
          id="mobile-nav"
          data-testid="mobile-nav"
          className="md:hidden border-t border-border-dark bg-surface-dark/95"
        >
          <nav className="flex flex-col px-4 py-3 gap-1">
            <NavLink
              to="/"
              className={navLinkClass}
              end
              onClick={closeMobileNav}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </NavLink>
            <NavLink
              to="/commands"
              className={navLinkClass}
              onClick={closeMobileNav}
            >
              <Terminal className="h-4 w-4" />
              Command Library
            </NavLink>
            <NavLink
              to="/ai"
              className={navLinkClass}
              onClick={closeMobileNav}
            >
              <Bot className="h-4 w-4" />
              AI Chat/Agent
            </NavLink>
            <NavLink
              to="/notes"
              className={navLinkClass}
              onClick={closeMobileNav}
            >
              <FileText className="h-4 w-4" />
              Notes
            </NavLink>
            <NavLink
              to="/reports"
              className={navLinkClass}
              onClick={closeMobileNav}
            >
              <BarChart3 className="h-4 w-4" />
              Reports
              {pendingReportCount > 0 ? (
                <Badge
                  data-testid="reports-nav-badge"
                  className="ml-2 h-4 min-w-4 px-1 text-[9px] font-bold"
                >
                  {pendingReportCount}
                </Badge>
              ) : null}
            </NavLink>
          </nav>
          <div className="border-t border-border-dark px-4 py-3 flex items-center gap-2">
            {showDevDiagnostics ? (
              <HealthDiagnosticsPanel
                className="rounded px-3 py-2"
                showLabel
              />
            ) : null}
            <button
              type="button"
              aria-label="Notifications"
              className="flex items-center gap-2 text-xs font-semibold text-text-primary bg-bg-tertiary border border-border-dark rounded px-3 py-2 hover:bg-surface-highlight transition-colors"
            >
              <Bell className="h-4 w-4 text-text-secondary" />
              Notifications
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Open profile menu"
                  className="flex items-center gap-2 text-xs font-semibold text-text-primary bg-bg-tertiary border border-border-dark rounded px-3 py-2 hover:bg-surface-highlight transition-colors"
                >
                  <div className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-[#38bdf8] to-[#0369a1] text-[9px] font-black text-white shadow-md">
                    {initials}
                  </div>
                  Profile
                  <ChevronDown className="size-3 text-text-secondary" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56 bg-[#1a2030] border-[#252b3a] text-slate-200 shadow-2xl"
              >
                <DropdownMenuLabel className="text-xs font-bold text-slate-500 uppercase tracking-widest px-3 py-2">
                  Pilot Profile
                </DropdownMenuLabel>
                <div className="px-3 pb-2">
                  <div className="text-sm font-semibold text-white">
                    {userLabel}
                  </div>
                  {userEmail && (
                    <div className="text-[10px] text-slate-500">{userEmail}</div>
                  )}
                </div>
                <DropdownMenuSeparator className="bg-white/5" />
                <DropdownMenuItem
                  className="gap-2 px-3 py-2 font-medium focus:bg-white/5 cursor-pointer"
                  onClick={() => handleNavigate("/")}
                >
                  <LayoutDashboard className="size-4 text-primary" />
                  Operator Console
                </DropdownMenuItem>
                {isSuperAdmin ? (
                  <DropdownMenuItem
                    className="gap-2 px-3 py-2 font-medium focus:bg-white/5 cursor-pointer"
                    onClick={() => handleNavigate("/settings")}
                  >
                    <Settings className="size-4 text-slate-400" />
                    Settings
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator className="bg-white/5" />
                <DropdownMenuItem
                  className="gap-2 px-3 py-2 font-bold text-red-400 focus:bg-red-400/10 cursor-pointer"
                  onClick={() => {
                    closeMobileNav();
                    onLogout();
                  }}
                >
                  <LogOut className="size-4" />
                  Terminate Session
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const currentProject = useProjectStore((state) => state.currentProject);
  const { pendingCount: pendingReportCount } = useReportBadge();

  // Show active project in header when on a project route
  const isProjectRoute = location.pathname.startsWith("/projects/");
  const activeProject = isProjectRoute ? currentProject : null;

  const userLabel =
    user?.display_name?.trim() ||
    user?.username ||
    user?.email?.split("@")[0] ||
    "Operator";
  const userEmail = user?.email || null;
  const initials = getInitials(userLabel);
  const isSuperAdmin = user?.is_super_admin === true;
  const showDevDiagnostics = import.meta.env.DEV;
  const projectVariableChips = activeProject
    ? Object.entries(activeProject.variables ?? {})
        .filter(isDisplayableVariable)
        .slice(0, MAX_HEADER_VARIABLES)
    : [];

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const [copiedChip, setCopiedChip] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedChip) return;
    const t = setTimeout(() => setCopiedChip(null), 1100);
    return () => clearTimeout(t);
  }, [copiedChip]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      "relative flex items-center gap-2 px-4 py-2.5 text-xs font-semibold transition-colors",
      "after:pointer-events-none after:absolute after:left-4 after:right-4 after:-bottom-px after:h-[2px] after:rounded-full after:bg-primary after:origin-center after:transition-transform after:duration-300 after:ease-out",
      isActive
        ? "text-white after:scale-x-100 after:shadow-[0_0_8px_rgba(14,165,233,0.6)]"
        : "text-text-muted hover:text-text-primary after:scale-x-0",
    ].join(" ");

  return (
    <div className="flex h-screen flex-col bg-background-dark text-text-primary antialiased overflow-hidden">
      <header className="z-50 border-b border-border-dark bg-surface-dark/95 backdrop-blur-md shadow-lg">
        <div
          className="h-14 px-4 flex items-center gap-6"
          data-testid="header-main"
        >
          <div className="flex items-center gap-6">
            <div
              className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => navigate("/")}
            >
              <div className="relative flex size-8 items-center justify-center">
                <img
                  src="/pwnpilot_logo.svg"
                  alt="PwnPilot"
                  className="size-8 logo-pulse"
                />
                <div className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-surface-dark bg-emerald-500" />
              </div>
              <span className="text-lg font-black tracking-tighter uppercase italic bg-gradient-to-b from-[#00FFFF] to-[#FF00FF] bg-clip-text text-transparent">
                PwnPilot
              </span>
            </div>

            <label className="hidden md:flex flex-col min-w-40 h-8 max-w-64">
              <div className="flex w-full flex-1 items-stretch rounded-md h-full group focus-within:ring-1 ring-primary/50 transition-all border border-border-dark bg-background-dark">
                <div className="text-text-secondary flex border-none items-center justify-center pl-3">
                  <Search className="h-4 w-4" />
                </div>
                <Input
                  placeholder="Search..."
                  className="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-md text-white focus:outline-0 focus:ring-0 border-none bg-transparent h-full placeholder:text-text-secondary px-3 text-sm font-normal"
                />
              </div>
            </label>

            {activeProject && (
              <>
                <div className="h-6 w-px bg-white/5" />
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 rounded-md bg-white/[0.03] border border-border-dark px-3 py-1.5 shadow-sm">
                    <Activity className="size-3.5 text-success-text animate-pulse" />
                    <span className="text-xs font-bold text-slate-100 uppercase tracking-tight">
                      {activeProject.name}
                    </span>
                    <Badge
                      variant="outline"
                      className="ml-2 h-4 border-primary/20 bg-primary/5 px-1 text-[8px] font-bold text-primary"
                    >
                      ACTIVE NODE
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {projectVariableChips.map(([key, value]) => {
                      const isCopied = copiedChip === key;
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            navigator.clipboard.writeText(value);
                            setCopiedChip(key);
                          }}
                          className={`relative flex max-w-56 shrink-0 items-center gap-1 rounded bg-target-bg border px-2 py-0.5 text-[10px] font-mono text-text-secondary hover:border-primary/30 hover:text-primary transition-colors cursor-pointer ${
                            isCopied
                              ? "chip-copied border-emerald-400/70"
                              : "border-border-dark"
                          }`}
                          title={`Click to copy: ${value}`}
                        >
                          <span className="text-primary/60">
                            ${key.replace(/_/g, "")}
                          </span>
                          <span className="max-w-32 truncate text-text-primary">
                            {formatVariablePreview(value)}
                          </span>
                          {isCopied && (
                            <span className="copy-pop pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-lg">
                              Copied
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {projectVariableChips.length === 0 && (
                      <span className="text-[10px] text-text-secondary font-mono">
                        No variables set
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <nav className="hidden md:flex w-full overflow-x-auto px-4 scrollbar-hide flex-1 min-w-0 justify-center">
            <NavLink to="/" className={navLinkClass} end>
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </NavLink>
            <NavLink to="/commands" className={navLinkClass}>
              <Terminal className="h-4 w-4" />
              Command Library
            </NavLink>
            <NavLink to="/ai" className={navLinkClass}>
              <Bot className="h-4 w-4" />
              AI Chat/Agent
            </NavLink>
            <NavLink to="/notes" className={navLinkClass}>
              <FileText className="h-4 w-4" />
              Notes
            </NavLink>
            <NavLink to="/reports" className={navLinkClass}>
              <BarChart3 className="h-4 w-4" />
              Reports
              {pendingReportCount > 0 ? (
                <Badge
                  data-testid="reports-nav-badge"
                  className="ml-2 h-4 min-w-4 px-1 text-[9px] font-bold"
                >
                  {pendingReportCount}
                </Badge>
              ) : null}
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            <MobileNavControls
              key={location.pathname}
              initials={initials}
              isSuperAdmin={isSuperAdmin}
              navLinkClass={navLinkClass}
              onLogout={handleLogout}
              onNavigate={navigate}
              pendingReportCount={pendingReportCount}
              userEmail={userEmail}
              userLabel={userLabel}
            />
            <div className="hidden md:flex items-center gap-2">
              {showDevDiagnostics ? (
                <HealthDiagnosticsPanel showLabel={false} />
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Notifications"
                className="relative h-9 w-9 text-text-secondary hover:text-white hover:bg-white/[0.05]"
              >
                <Bell className="size-4" />
                <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-primary shadow-[0_0_5px_rgba(14,165,233,0.8)]" />
              </Button>

              <div className="mx-2 h-5 w-px bg-border-dark" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open profile menu"
                    className="flex items-center gap-2.5 rounded-full bg-white/[0.03] border border-border-dark p-1 pr-3 hover:bg-white/[0.05] transition-all"
                  >
                    <div className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-[#38bdf8] to-[#0369a1] text-[10px] font-black text-white shadow-md">
                      {initials}
                    </div>
                    <span className="text-xs font-semibold text-slate-200">
                      {userLabel}
                    </span>
                    <ChevronDown className="size-3 text-text-secondary" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 bg-[#1a2030] border-[#252b3a] text-slate-200 shadow-2xl"
                >
                  <DropdownMenuLabel className="text-xs font-bold text-slate-500 uppercase tracking-widest px-3 py-2">
                    Pilot Profile
                  </DropdownMenuLabel>
                  <div className="px-3 pb-2">
                    <div className="text-sm font-semibold text-white">
                      {userLabel}
                    </div>
                    {userEmail && (
                      <div className="text-[10px] text-slate-500">
                        {userEmail}
                      </div>
                    )}
                  </div>
                  <DropdownMenuSeparator className="bg-white/5" />
                  <DropdownMenuItem
                    className="gap-2 px-3 py-2 font-medium focus:bg-white/5 cursor-pointer"
                    onClick={() => navigate("/")}
                  >
                    <LayoutDashboard className="size-4 text-primary" />
                    Operator Console
                  </DropdownMenuItem>
                  {isSuperAdmin ? (
                    <DropdownMenuItem
                      className="gap-2 px-3 py-2 font-medium focus:bg-white/5 cursor-pointer"
                      onClick={() => navigate("/settings")}
                    >
                      <Settings className="size-4 text-slate-400" />
                      Settings
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator className="bg-white/5" />
                  <DropdownMenuItem
                    className="gap-2 px-3 py-2 font-bold text-red-400 focus:bg-red-400/10 cursor-pointer"
                    onClick={handleLogout}
                  >
                    <LogOut className="size-4" />
                    Terminate Session
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-hidden flex flex-col">
        <div
          key={location.pathname}
          className="page-transition flex-1 flex flex-col min-h-0"
        >
          {children}
        </div>
      </main>
    </div>
  );
}
