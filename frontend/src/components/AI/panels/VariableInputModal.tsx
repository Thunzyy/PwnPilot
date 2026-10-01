import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PromptTemplate } from "@/types/ai";

interface ParsedVariable {
  name: string;
  defaultValue: string | null;
}

interface VariableInputModalProps {
  template: PromptTemplate;
  onInsert: (interpolatedContent: string) => void;
  onCancel: () => void;
}

/**
 * Parse variables from template.
 * Supports formats: {variable} and {variable:default}
 */
function parseVariables(variables: string[]): ParsedVariable[] {
  return variables.map((v) => {
    const colonIndex = v.indexOf(":");
    if (colonIndex === -1) {
      return { name: v, defaultValue: null };
    }
    return {
      name: v.substring(0, colonIndex),
      defaultValue: v.substring(colonIndex + 1),
    };
  });
}

/**
 * Interpolate variables into template content.
 */
function interpolate(content: string, values: Record<string, string>): string {
  let result = content;
  for (const [name, value] of Object.entries(values)) {
    // Replace both {name} and {name:default} patterns
    const patternSimple = new RegExp(`\\{${name}\\}`, "g");
    const patternWithDefault = new RegExp(`\\{${name}:[^}]*\\}`, "g");
    result = result.replace(patternSimple, value);
    result = result.replace(patternWithDefault, value);
  }
  return result;
}

export function VariableInputModal({ template, onInsert, onCancel }: VariableInputModalProps) {
  const parsedVars = parseVariables(template.variables);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const v of parsedVars) {
      initial[v.name] = v.defaultValue || "";
    }
    return initial;
  });

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const handleSubmit = () => {
    const interpolated = interpolate(template.content, values);
    onInsert(interpolated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#121722] border border-white/10 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div>
            <h3 className="text-sm font-semibold text-white">{template.name}</h3>
            {template.description && (
              <p className="text-xs text-slate-400 mt-0.5">{template.description}</p>
            )}
          </div>
          <button
            onClick={onCancel}
            className="p-1 text-slate-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Variables Form */}
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-500">Fill in the variables to customize this template:</p>
          {parsedVars.map((v) => (
            <div key={v.name} className="space-y-1">
              <label className="text-xs text-slate-300">
                {v.name}
                {v.defaultValue === null && <span className="text-red-400 ml-1">*</span>}
              </label>
              <Input
                value={values[v.name]}
                onChange={(e) => setValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                onKeyDown={handleKeyDown}
                placeholder={v.defaultValue || `Enter ${v.name}`}
                className="h-8 text-xs bg-white/[0.03] border-white/10"
                autoFocus={parsedVars.indexOf(v) === 0}
              />
            </div>
          ))}
        </div>

        {/* Preview */}
        <div className="px-4 pb-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Preview</div>
          <div className="p-2 bg-white/[0.02] border border-white/5 rounded-md max-h-32 overflow-y-auto">
            <pre className="text-[10px] text-slate-400 whitespace-pre-wrap font-mono">
              {interpolate(template.content, values).slice(0, 500)}
              {interpolate(template.content, values).length > 500 && "..."}
            </pre>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 p-4 border-t border-white/10">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="flex-1 h-8 text-xs bg-primary"
            onClick={handleSubmit}
          >
            Insert
          </Button>
        </div>
      </div>
    </div>
  );
}
