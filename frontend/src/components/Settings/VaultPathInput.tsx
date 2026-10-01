import { useState } from "react";
import { CheckCircle, FolderCheck, Loader2, XCircle } from "lucide-react";
import { kbApi } from "@/api/kb";
import type { PathValidationResult } from "@/types/kb";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function VaultPathInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (path: string) => void;
}) {
  const [validationResult, setValidationResult] =
    useState<PathValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  async function handleValidate() {
    if (!value.trim()) return;
    setIsValidating(true);
    setValidationResult(null);
    try {
      const result = await kbApi.validatePath(value.trim());
      setValidationResult(result);
    } catch {
      setValidationResult({
        path: value,
        exists: false,
        is_directory: false,
        is_obsidian_vault: false,
      });
    } finally {
      setIsValidating(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-300">
        Default Vault Path
      </label>
      <p className="text-xs text-slate-500">
        Default path used when adding new local vaults. Each source keeps its
        own path.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="/home/user/obsidian-vault"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setValidationResult(null);
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={handleValidate}
          disabled={isValidating || !value.trim()}
        >
          {isValidating ? "Validating..." : "Validate"}
        </Button>
      </div>
      <ValidationFeedback
        result={validationResult}
        isValidating={isValidating}
      />
    </div>
  );
}

function ValidationFeedback({
  result,
  isValidating,
}: {
  result: PathValidationResult | null;
  isValidating: boolean;
}) {
  if (isValidating) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" />
        Validating...
      </p>
    );
  }

  if (!result) return null;

  if (result.is_obsidian_vault) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-400">
        <CheckCircle className="size-3.5" />
        Obsidian vault detected
      </p>
    );
  }

  if (result.is_directory) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-amber-400">
        <FolderCheck className="size-3.5" />
        Valid directory (not an Obsidian vault)
      </p>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-xs text-red-400">
      <XCircle className="size-3.5" />
      Path not found on server
    </p>
  );
}
