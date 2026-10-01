import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DialogDescription,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AISettings } from '@/components/Settings/AISettings';

interface AIQuickSettingsProps {
  label?: string;
  variant?: "default" | "secondary";
}

export function AIQuickSettings({
  label,
  variant = "default",
}: AIQuickSettingsProps) {
  const trigger = label ? (
    <Button type="button" variant={variant}>
      {label}
    </Button>
  ) : (
    <button
      type="button"
      className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
      title="AI Provider Settings"
    >
      <Settings2 className="h-4 w-4" />
    </button>
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col bg-[#121722] border-white/10">
        <DialogHeader>
          <DialogTitle className="text-white">AI Providers</DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            Configure AI providers and default models for this workspace.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          <AISettings />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
