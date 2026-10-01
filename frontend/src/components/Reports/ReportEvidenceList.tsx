import type { ReportEvidenceLink } from "@/types/report";

type ReportEvidenceListProps = {
  evidenceLinks: ReportEvidenceLink[];
};

function formatEvidenceLabel(evidence: ReportEvidenceLink): string {
  if (evidence.label) {
    return evidence.label;
  }
  return evidence.sourceType.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatEvidencePreview(evidence: ReportEvidenceLink): string {
  return evidence.preview ?? evidence.sourceId;
}

export function ReportEvidenceList({ evidenceLinks }: ReportEvidenceListProps) {
  if (evidenceLinks.length === 0) {
    return (
      <p className="text-xs text-text-secondary">No evidence linked.</p>
    );
  }

  return (
    <div className="mt-2 flex min-w-0 flex-wrap gap-2">
      {evidenceLinks.map((evidence) => {
        const label = formatEvidenceLabel(evidence);
        const preview = formatEvidencePreview(evidence);
        const content = (
          <>
            <span className="font-semibold text-text-primary">{label}</span>
            <span aria-hidden="true" className="text-text-secondary">
              :
            </span>
            <span className="min-w-0 break-all text-text-secondary">{preview}</span>
          </>
        );

        if (evidence.href) {
          return (
            <a
              key={evidence.id}
              href={evidence.href}
              aria-label={`${label}: ${preview}`}
              className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border-dark bg-card-dark px-2 py-1 text-xs hover:border-accent/70 hover:text-text-primary"
            >
              {content}
            </a>
          );
        }

        return (
          <span
            key={evidence.id}
            className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border-dark bg-card-dark px-2 py-1 text-xs"
          >
            {content}
          </span>
        );
      })}
    </div>
  );
}
