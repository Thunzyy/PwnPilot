import { cn } from '@/lib/utils';
import type { AgentStatus } from '@/types/agent';

const STATUS_CONFIG: Record<AgentStatus, { color: string; label: string; pulse?: boolean }> = {
  starting: { color: 'bg-yellow-500', label: 'Starting', pulse: true },
  running: { color: 'bg-green-500', label: 'Running', pulse: true },
  stopping: { color: 'bg-orange-500', label: 'Stopping', pulse: true },
  stopped: { color: 'bg-slate-500', label: 'Stopped' },
  error: { color: 'bg-red-500', label: 'Error' },
};

interface AgentStatusBadgeProps {
  status: AgentStatus;
}

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div
        className={cn('size-1.5 rounded-full', config.color, config.pulse && 'animate-pulse')}
      />
      <span className="text-xs text-slate-300">{config.label}</span>
    </div>
  );
}
