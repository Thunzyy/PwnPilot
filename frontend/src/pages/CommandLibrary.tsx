import { Link } from "react-router-dom";
import { CommandsLibrary } from "@/components/Commands/CommandsLibrary";
import { VariablesPanel } from "@/components/Commands/VariablesPanel";
import { Button } from "@/components/ui/button";
import { useCommandGlobalsStore } from "@/stores/commandGlobalsStore";

export function CommandLibraryPage() {
  const {
    variables,
    setVariable,
    removeVariable,
    addVariable,
    resetDefaults,
  } = useCommandGlobalsStore();

  const handleCopyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background-dark">
      <div className="flex flex-col gap-6 w-full min-h-full px-6 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">
              Command Library
            </h2>
            <p className="text-sm text-slate-400">
              Browse commands, manage favorites, and fine-tune filters.
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link to="/commands/settings">Manage Library</Link>
          </Button>
        </div>
        <VariablesPanel
          title="Global Variables"
          variables={variables}
          onVariableChange={setVariable}
          onVariableRemove={removeVariable}
          onVariableAdd={addVariable}
          onReset={resetDefaults}
          collapsible
          defaultOpen={false}
        />

        <CommandsLibrary
          variables={variables}
          onCopyCommand={handleCopyCommand}
          fullPageScroll
        />
      </div>
    </div>
  );
}
