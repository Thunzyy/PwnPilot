import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { fetchSettings, settingsQueryKeys } from "@/api/settings";
import { Button } from "@/components/ui/button";
import { OperatorSettings } from "@/components/Settings/OperatorSettings";
import { SourceManagement } from "@/components/Settings/SourceManagement";
import { AISettings } from "@/components/Settings/AISettings";
import { AgentSettings } from "@/components/Settings/AgentSettings";

const NAV_ITEMS = [
  { label: "Profile", key: "profile" },
  { label: "AI Providers", key: "ai" },
  { label: "Agent Configs", key: "agents" },
  { label: "Knowledge Sources", key: "sources" },
] as const;

export function SettingsPage() {
  const navigate = useNavigate();
  useQuery({
    queryKey: settingsQueryKeys.current,
    queryFn: fetchSettings,
  });
  const profileRef = useRef<HTMLDivElement>(null);
  const aiRef = useRef<HTMLDivElement>(null);
  const agentsRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);

  function scrollTo(key: string) {
    const refs: Record<string, React.RefObject<HTMLDivElement | null>> = {
      profile: profileRef,
      ai: aiRef,
      agents: agentsRef,
      sources: sourcesRef,
    };
    refs[key]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex-1 overflow-auto bg-[#0b0f17]">
      <div className="flex w-full flex-col gap-6 px-6 py-8 lg:px-8 2xl:px-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">Settings</h2>
            <p className="text-sm text-slate-400">
              Manage your operator profile, platform defaults, and runtime configuration.
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="h-9 justify-start gap-2 text-slate-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to console
          </Button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <nav className="rounded-2xl border border-white/6 bg-[#121722] p-4 shadow-2xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                Sections
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {NAV_ITEMS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => scrollTo(item.key)}
                    className="rounded-xl border border-transparent px-3 py-2 text-left text-sm text-slate-400 transition-colors hover:border-white/10 hover:bg-white/[0.03] hover:text-white"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </nav>
          </aside>

          <div className="min-w-0 space-y-6">
            <div ref={profileRef}>
              <OperatorSettings />
            </div>

            <div
              ref={aiRef}
              className="rounded-[28px] border border-white/6 bg-[#121722] p-6 shadow-2xl lg:p-8"
            >
              <AISettings />
            </div>

            <div
              ref={agentsRef}
              className="rounded-[28px] border border-white/6 bg-[#121722] p-6 shadow-2xl lg:p-8"
            >
              <AgentSettings />
            </div>

            <div
              ref={sourcesRef}
              className="rounded-[28px] border border-white/6 bg-[#121722] p-6 shadow-2xl lg:p-8"
            >
              <SourceManagement />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
