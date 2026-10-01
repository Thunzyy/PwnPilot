import { useEffect, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { VariablesPanel } from "@/components/Commands/VariablesPanel";
import { CommandSettingsSections } from "@/components/Commands/CommandSettingsSections";
import { useCommandSettingsStore } from "@/stores/commandSettingsStore";

export function CommandSettingsPage() {
  const navigate = useNavigate();
  const variables = useCommandSettingsStore((state) => state.variables);
  const isLoading = useCommandSettingsStore((state) => state.isLoading);
  const error = useCommandSettingsStore((state) => state.error);
  const loadGlobalSettings = useCommandSettingsStore(
    (state) => state.loadGlobalSettings
  );
  const updateGlobalVariables = useCommandSettingsStore(
    (state) => state.updateGlobalVariables
  );

  const [draftVariables, setDraftVariables] = useState<Record<string, string>>(
    {}
  );

  useEffect(() => {
    loadGlobalSettings();
  }, [loadGlobalSettings]);

  useEffect(() => {
    setDraftVariables(variables);
  }, [variables]);

  const handleVariableChange = (key: string, value: string) => {
    setDraftVariables((prev) => ({ ...prev, [key]: value }));
  };

  const handleVariableRemove = (key: string) => {
    setDraftVariables((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleVariableAdd = (key: string, value: string) => {
    setDraftVariables((prev) => ({ ...prev, [key]: value }));
  };

  const handleVariableReset = () => {
    setDraftVariables(variables);
  };

  const handleVariableSave = async () => {
    await updateGlobalVariables(draftVariables);
  };

  return (
    <div className="flex-1 overflow-auto bg-background-dark">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">
              Command Settings
            </h2>
            <p className="text-sm text-slate-400">
              Manage global commands, categories, filters, and variables.
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => navigate("/commands")}
            className="h-9 justify-start gap-2 text-slate-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to library
          </Button>
        </div>

        {error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center gap-3 rounded-md border border-border-dark bg-card-dark px-4 py-3 text-sm text-slate-300">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Syncing command settings...
          </div>
        ) : null}

        <CommandSettingsSections scope="global" />

        <section className="bg-card-dark border border-border-dark rounded-md p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Variables</h3>
            <Button size="sm" onClick={handleVariableSave}>
              <Save className="h-4 w-4" />
              Save Variables
            </Button>
          </div>
          <VariablesPanel
            title="Global Variables"
            variables={draftVariables}
            onVariableChange={handleVariableChange}
            onVariableRemove={handleVariableRemove}
            onVariableAdd={handleVariableAdd}
            onReset={handleVariableReset}
          />
        </section>
      </div>
    </div>
  );
}
