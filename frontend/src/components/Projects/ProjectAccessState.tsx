import { startTransition, useState } from "react";
import { ArrowLeft, Clock3, LockKeyhole, ShieldX } from "lucide-react";

import { requestProjectAccess, type ProjectMembershipStatus } from "@/api/projects";
import { Button } from "@/components/ui/button";

interface ProjectAccessStateProps {
  projectId: string;
  initialStatus: ProjectMembershipStatus;
  onBackToDashboard: () => void;
}

const ACCESS_COPY: Record<
  ProjectMembershipStatus,
  {
    title: string;
    description: string;
    icon: typeof LockKeyhole;
  }
> = {
  active: {
    title: "Project access granted",
    description: "This project is available. Reload if the workspace did not open yet.",
    icon: LockKeyhole,
  },
  none: {
    title: "Request project access",
    description:
      "You are authenticated, but you are not yet a member of this project. Send an access request to notify a project admin.",
    icon: LockKeyhole,
  },
  pending: {
    title: "Access request pending",
    description:
      "Your request has been sent. A project admin must approve it before this workspace becomes visible.",
    icon: Clock3,
  },
  denied: {
    title: "Access request denied",
    description:
      "An admin denied this access request. Ask the project owner for clarification before retrying from their side.",
    icon: ShieldX,
  },
};

export function ProjectAccessState({
  projectId,
  initialStatus,
  onBackToDashboard,
}: ProjectAccessStateProps) {
  const [membershipStatus, setMembershipStatus] =
    useState<ProjectMembershipStatus>(initialStatus);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const content = ACCESS_COPY[membershipStatus] ?? ACCESS_COPY.none;
  const Icon = content.icon;

  const handleRequestAccess = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await requestProjectAccess(projectId);
      startTransition(() => {
        setMembershipStatus(response.status);
      });
    } catch {
      setError("Failed to send the access request");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-background-dark px-6">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#121722] p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-white">{content.title}</h1>
            <p className="mt-1 text-sm text-slate-400">{content.description}</p>
          </div>
        </div>

        {error ? <p className="mb-4 text-sm text-rose-400">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          {membershipStatus === "none" ? (
            <Button onClick={handleRequestAccess} disabled={isSubmitting}>
              {isSubmitting ? "Requesting access..." : "Request access"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="text-slate-300 hover:text-white"
            onClick={onBackToDashboard}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
