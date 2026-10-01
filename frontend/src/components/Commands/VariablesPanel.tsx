import { useState } from "react";
import { ChevronDown, X, Plus } from "lucide-react";

interface VariablesPanelProps {
  title: string;
  variables: Record<string, string>;
  onVariableChange: (key: string, value: string) => void;
  onVariableRemove: (key: string) => void;
  onVariableAdd: (key: string, value: string) => void;
  onReset: () => void;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export function VariablesPanel({
  title,
  variables,
  onVariableChange,
  onVariableRemove,
  onVariableAdd,
  onReset,
  collapsible = false,
  defaultOpen = true,
}: VariablesPanelProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const handleAdd = () => {
    const key = newKey.trim();
    if (!key) return;
    onVariableAdd(key, newValue.trim());
    setNewKey("");
    setNewValue("");
  };

  return (
    <section className="bg-card-dark border border-border-dark rounded-md overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-border-dark flex justify-between items-center bg-surface-dark">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="flex items-center gap-2 text-left"
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Hide" : "Show"} ${title}`}
          >
            <ChevronDown
              className={`h-4 w-4 text-text-muted transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
            <span className="material-symbols-outlined text-text-muted text-[20px]">
              settings_input_component
            </span>
            <h2 className="text-white text-sm font-semibold">{title}</h2>
            <span className="text-[10px] text-text-muted">
              {Object.keys(variables).length} vars
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-text-muted text-[20px]">
              settings_input_component
            </span>
            <h2 className="text-white text-sm font-semibold">{title}</h2>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-text-muted hover:text-white transition-colors border border-border-dark rounded px-3 py-1 bg-background-dark hover:bg-bg-tertiary"
          >
            Reset Defaults
          </button>
        </div>
      </div>
      {(!collapsible || isOpen) && (
        <div className="p-4 bg-background-dark">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(variables).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1.5 group">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] uppercase tracking-wider text-text-muted font-mono font-medium">
                    {`{${key}}`}
                  </label>
                  <button
                    type="button"
                    onClick={() => onVariableRemove(key)}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-red transition-opacity"
                    title="Delete variable"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  className="bg-surface-dark border border-border-dark text-accent-blue text-xs rounded px-2.5 py-2 focus:ring-1 focus:ring-primary focus:border-primary font-mono w-full transition-shadow placeholder-text-muted/50"
                  placeholder="Value"
                  value={value}
                  onChange={(event) =>
                    onVariableChange(key, event.currentTarget.value)
                  }
                />
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-border-dark flex flex-wrap gap-2 items-center">
            <span className="text-xs text-text-muted mr-2">Add Variable:</span>
            <input
              className="bg-surface-dark border border-border-dark text-text-primary text-xs rounded px-2.5 py-1.5 font-mono w-32 focus:border-primary focus:ring-1 focus:ring-primary placeholder-text-muted"
              placeholder="{key}"
              value={newKey}
              onChange={(event) => setNewKey(event.currentTarget.value)}
            />
            <span className="text-text-muted">:</span>
            <input
              className="bg-surface-dark border border-border-dark text-text-primary text-xs rounded px-2.5 py-1.5 font-mono w-32 focus:border-primary focus:ring-1 focus:ring-primary placeholder-text-muted"
              placeholder="Value"
              value={newValue}
              onChange={(event) => setNewValue(event.currentTarget.value)}
            />
            <button
              type="button"
              onClick={handleAdd}
              className="flex items-center gap-1 text-xs font-medium text-white bg-bg-tertiary border border-border-dark hover:bg-surface-highlight hover:border-text-muted rounded px-3 py-1.5 transition-all ml-1"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
