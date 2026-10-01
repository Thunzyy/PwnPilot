import { useEffect, useCallback, useRef } from 'react';
import { Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { XTerminal } from '@/components/Terminal/XTerminal';
import { AgentStatusBadge } from './AgentStatusBadge';
import { useAgentProcessStore } from '@/stores/agentProcessStore';

interface AgentTerminalPanelProps {
  agentId: string;
}

export function AgentTerminalPanel({ agentId }: AgentTerminalPanelProps) {
  const process = useAgentProcessStore((s) => s.processes.find((p) => p.id === agentId));
  const stopAgent = useAgentProcessStore((s) => s.stopAgent);
  const pollStatus = useAgentProcessStore((s) => s.pollStatus);
  const executeCommand = useAgentProcessStore((s) => s.executeCommand);
  const executedRef = useRef(false);

  // When terminal connects, trigger the agent command
  const handleTerminalConnect = useCallback(() => {
    if (executedRef.current) return;
    executedRef.current = true;
    executeCommand(agentId);
  }, [agentId, executeCommand]);

  // Poll agent status every 2s while active
  useEffect(() => {
    const isActive = process?.status === 'starting' || process?.status === 'running';
    if (!isActive) return;

    const interval = setInterval(() => {
      pollStatus(agentId);
    }, 2000);

    return () => clearInterval(interval);
  }, [agentId, process?.status, pollStatus]);

  if (!process) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Agent not found
      </div>
    );
  }

  if (!process.websocketUrl) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
        <span className="text-sm text-slate-400">Agent starting...</span>
        <AgentStatusBadge status={process.status} />
      </div>
    );
  }

  const isActive = process.status === 'starting' || process.status === 'running';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-800 bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AgentStatusBadge status={process.status} />
        </div>

        {isActive && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-slate-400 hover:text-red-400 hover:bg-red-400/10 gap-1 shrink-0"
            onClick={() => stopAgent(agentId)}
          >
            <Square className="h-3 w-3" />
            Stop
          </Button>
        )}
      </div>

      {/* Terminal */}
      <div className="flex-1 min-h-0 flex flex-col">
        <XTerminal
          sessionId={process.tmuxSession}
          websocketUrl={process.websocketUrl!}
          readOnly={false}
          onConnect={handleTerminalConnect}
        />
      </div>
    </div>
  );
}
