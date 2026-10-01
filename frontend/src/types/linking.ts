// Linking & MITRE ATT&CK TypeScript types -- mirrors backend schemas.

// =============================================================================
// Link types
// =============================================================================

/** Response after creating a timeline-entry <-> KB-doc link. */
export interface LinkCreateResponse {
  id: string;
  timeline_entry_id: string;
  doc_id: string;
  created_at: string;
}

/** A timeline engagement linked to a KB document (returned by "Used in" queries). */
export interface LinkedEngagement {
  timeline_entry_id: string;
  project_id: string;
  project_name: string;
  entry_type: string;
  entry_content: string;
  created_at: string;
}

/** A KB document linked to a timeline entry (returned by "Related knowledge" queries). */
export interface LinkedDoc {
  doc_id: string;
  title: string;
  relative_path: string;
  source_id: string;
}

// =============================================================================
// MITRE ATT&CK types
// =============================================================================

/** A single MITRE ATT&CK technique (from static catalog or search results). */
export interface MitreTechnique {
  id: string;
  name: string;
  tactic: string;
}

/** Response after adding/removing a MITRE tag on a KB document. */
export interface MitreTagResponse {
  doc_id: string;
  tags: string;
  mitre_techniques: string[];
}
