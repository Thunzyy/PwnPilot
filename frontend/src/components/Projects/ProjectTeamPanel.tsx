import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";
import type { Membership } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ProjectTeamPanelProps {
  projectId: string;
}

interface MemberRowProps {
  member: Membership;
  isLoading: boolean;
  onStatusUpdate: (membershipId: string, status: string) => void;
}

interface InviteFormProps {
  inviteTarget: string;
  inviteRole: string;
  isLoading: boolean;
  onInviteTargetChange: (value: string) => void;
  onInviteRoleChange: (value: string) => void;
  onInvite: () => void;
}

const ROLE_OPTIONS = ["member", "admin"];
const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  denied: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

const formatLabel = (value: string) =>
  value ? value[0].toUpperCase() + value.slice(1) : value;

const getPrimaryIdentity = (member: Membership) =>
  member.display_name?.trim() ||
  member.username?.trim() ||
  member.email?.trim() ||
  member.user_id;

function MemberRow({ member, isLoading, onStatusUpdate }: MemberRowProps) {
  const primaryIdentity = getPrimaryIdentity(member);
  const showUsername = Boolean(
    member.username && primaryIdentity !== member.username
  );
  const showEmail = Boolean(member.email && primaryIdentity !== member.email);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/5 bg-black/20 p-4 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">
          User
        </div>
        <div className="text-sm font-medium text-white">{primaryIdentity}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          {showUsername ? <span>@{member.username}</span> : null}
          {showEmail ? <span>{member.email}</span> : null}
          {member.team ? <span>Team {member.team}</span> : null}
          <span className="font-mono text-[11px] text-slate-600">
            {member.user_id}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={cn(
            "border font-medium capitalize",
            STATUS_STYLES[member.status] ||
              "bg-slate-500/10 text-slate-400 border-slate-500/20"
          )}
        >
          {formatLabel(member.status)}
        </Badge>
        <Badge variant="outline" className="border-white/10 text-[10px] uppercase tracking-widest text-slate-400">
          {member.role}
        </Badge>
        <Badge variant="outline" className="border-white/10 text-[10px] uppercase tracking-widest text-slate-500">
          {member.source}
        </Badge>
      </div>
      {member.status === "pending" && (
        <div className="flex gap-2">
          <Button size="sm" className="h-8" disabled={isLoading} onClick={() => onStatusUpdate(member.id, "active")}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-slate-400 hover:text-white" disabled={isLoading} onClick={() => onStatusUpdate(member.id, "denied")}>
            Deny
          </Button>
        </div>
      )}
    </div>
  );
}

function InviteForm({
  inviteTarget,
  inviteRole,
  isLoading,
  onInviteTargetChange,
  onInviteRoleChange,
  onInvite,
}: InviteFormProps) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#121722]/70 p-4 space-y-3">
      <div>
        <h4 className="text-xs uppercase tracking-widest text-slate-500">
          Invite collaborator
        </h4>
        <p className="text-xs text-slate-500">
          Add an operator by username or email.
        </p>
      </div>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <Input
          aria-label="Invite username or email"
          placeholder="username or email"
          value={inviteTarget}
          onChange={(event) => onInviteTargetChange(event.target.value)}
          className="bg-black/30 border-white/10"
        />
        <select
          aria-label="Invite role"
          value={inviteRole}
          onChange={(event) => onInviteRoleChange(event.target.value)}
          className="h-9 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/60"
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {formatLabel(role)}
            </option>
          ))}
        </select>
        <Button
          onClick={onInvite}
          disabled={isLoading || !inviteTarget.trim()}
          className="h-9"
        >
          Invite
        </Button>
      </div>
    </div>
  );
}

export function ProjectTeamPanel({ projectId }: ProjectTeamPanelProps) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [inviteTarget, setInviteTarget] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMemberships = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<Membership[]>(
        `/projects/${projectId}/memberships`
      );
      setMemberships(response.data);
    } catch {
      setError("Unable to load team members");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadMemberships();
  }, [loadMemberships]);

  const handleInvite = async () => {
    const target = inviteTarget.trim();
    if (!target) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/invites`, {
        username_or_email: target,
        role: inviteRole,
      });
      const response = await api.get<Membership[]>(
        `/projects/${projectId}/memberships`
      );
      setMemberships(response.data);
      setInviteTarget("");
    } catch {
      setError("Failed to send invite");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusUpdate = async (membershipId: string, status: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.patch(`/projects/${projectId}/memberships/${membershipId}`, {
        status,
      });
      const response = await api.get<Membership[]>(
        `/projects/${projectId}/memberships`
      );
      setMemberships(response.data);
    } catch {
      setError("Failed to update member");
    } finally {
      setIsLoading(false);
    }
  };

  const pendingMemberships = memberships.filter(
    (member) => member.status === "pending"
  );
  const nonPendingMemberships = memberships.filter(
    (member) => member.status !== "pending"
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-white">Team</h3>
        <p className="text-xs text-slate-500">
          Manage access and track collaborator status.
        </p>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {memberships.length === 0 ? (
        <div className="rounded-lg border border-white/5 bg-black/20 p-4 text-xs text-slate-500">
          No team members yet.
        </div>
      ) : (
        <div className="space-y-4">
          {pendingMemberships.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs uppercase tracking-widest text-amber-300">
                  Pending access requests
                </h4>
                <Badge
                  variant="outline"
                  className="border-amber-500/20 text-[10px] text-amber-300"
                >
                  {pendingMemberships.length}
                </Badge>
              </div>
              {pendingMemberships.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  isLoading={isLoading}
                  onStatusUpdate={handleStatusUpdate}
                />
              ))}
            </section>
          ) : null}

          {nonPendingMemberships.length > 0 ? (
            <section className="space-y-2">
              <h4 className="text-xs uppercase tracking-widest text-slate-500">
                Members
              </h4>
              {nonPendingMemberships.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  isLoading={isLoading}
                  onStatusUpdate={handleStatusUpdate}
                />
              ))}
            </section>
          ) : null}
        </div>
      )}

      <InviteForm
        inviteTarget={inviteTarget}
        inviteRole={inviteRole}
        isLoading={isLoading}
        onInviteTargetChange={setInviteTarget}
        onInviteRoleChange={setInviteRole}
        onInvite={handleInvite}
      />
    </div>
  );
}
