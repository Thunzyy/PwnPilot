import { useRef, useEffect } from 'react';
import { useAgentProcessStore } from '@/stores/agentProcessStore';
import { ToolCallBlock } from './ToolCallBlock';
import type { ToolCallData } from '@/types/ai';
import type { AgentToolCall } from '@/types/agent';

function mapToToolCallData(tc: AgentToolCall, index: number): ToolCallData {
  return {
    callId: `${tc.timestamp}-${index}`,
    seq: index,
    name: tc.name,
    args: tc.args,
    result: tc.resultPreview,
    error: tc.error ?? undefined,
    durationMs: tc.durationMs,
    status: tc.success ? 'success' : 'error',
  };
}

export function AgentToolCallsPanel() {
  const toolCalls = useAgentProcessStore((s) => s.toolCalls);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new tool calls
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [toolCalls.length]);

  if (toolCalls.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-xs py-8">
        Tool calls will appear here as the agent works
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1">
      {toolCalls.map((tc, i) => (
        <ToolCallBlock key={`${tc.timestamp}-${i}`} toolCall={mapToToolCallData(tc, i)} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
