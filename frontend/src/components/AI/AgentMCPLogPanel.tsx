import { useState, useEffect, useCallback } from 'react';
import { useAgentProcessStore } from '@/stores/agentProcessStore';
import { agentApi } from '@/api/agent';
import type { MCPLogEntry } from '@/types/agent';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

function LogEntry({ log, expanded, onToggle }: {
  log: MCPLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-white/5 rounded-md bg-slate-900/50">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
          {formatTime(log.createdAt)}
        </span>
        <span className="text-xs font-mono text-slate-300 truncate flex-1">
          {log.toolName}
        </span>
        <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
          {log.durationMs}ms
        </span>
        {log.success ? (
          <span className="text-[10px] text-emerald-400 shrink-0">OK</span>
        ) : (
          <span className="text-[10px] text-red-400 shrink-0">ERR</span>
        )}
      </button>

      {expanded && (
        <div className="px-2.5 pb-2 space-y-1.5 border-t border-white/5">
          <div className="pt-1.5">
            <span className="text-[10px] text-slate-500 uppercase">Args</span>
            <pre className="text-[11px] text-slate-400 bg-black/30 rounded p-1.5 mt-0.5 overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(log.toolArgs, null, 2)}
            </pre>
          </div>
          {log.toolResult && (
            <div>
              <span className="text-[10px] text-slate-500 uppercase">Result</span>
              <pre className="text-[11px] text-slate-400 bg-black/30 rounded p-1.5 mt-0.5 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
                {log.toolResult}
              </pre>
            </div>
          )}
          {log.error && (
            <div>
              <span className="text-[10px] text-red-400 uppercase">Error</span>
              <pre className="text-[11px] text-red-300 bg-red-950/30 rounded p-1.5 mt-0.5 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
                {log.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentMCPLogPanel() {
  const activeAgentId = useAgentProcessStore((s) => s.activeAgentId);
  const [logs, setLogs] = useState<MCPLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = useCallback(async (agentId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await agentApi.getMCPLogs(agentId);
      setLogs(result.items);
    } catch {
      setError('Failed to load MCP logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeAgentId) {
      fetchLogs(activeAgentId);
    } else {
      setLogs([]);
    }
  }, [activeAgentId, fetchLogs]);

  if (!activeAgentId) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-xs py-8">
        No agent selected. Launch an agent to view MCP history.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-xs py-8">
        Loading MCP history...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8">
        <span className="text-red-400 text-xs">{error}</span>
        <button
          onClick={() => fetchLogs(activeAgentId)}
          className="text-xs text-primary hover:text-primary/80 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-xs py-8 text-center px-4">
        No MCP logs available. Logs appear after agent tool calls are recorded.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-1">
      {logs.map((log) => (
        <LogEntry
          key={log.id}
          log={log}
          expanded={expandedId === log.id}
          onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
        />
      ))}
    </div>
  );
}
