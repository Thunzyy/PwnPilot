import { api } from './client';
import type {
  LinkCreateResponse,
  LinkedEngagement,
  LinkedDoc,
  MitreTechnique,
  MitreTagResponse,
} from '../types/linking';

export const linkingApi = {
  // Link management
  createLink: (entryId: string, docId: string) =>
    api
      .post<LinkCreateResponse>(`/linking/timeline/${entryId}/kb/${docId}`)
      .then((r) => r.data),

  deleteLink: (entryId: string, docId: string) =>
    api.delete(`/linking/timeline/${entryId}/kb/${docId}`),

  // Bidirectional queries
  getDocEngagements: (docId: string) =>
    api
      .get<LinkedEngagement[]>(`/linking/kb/${docId}/engagements`)
      .then((r) => r.data),

  getEntryDocs: (entryId: string) =>
    api
      .get<LinkedDoc[]>(`/linking/timeline/${entryId}/docs`)
      .then((r) => r.data),

  // MITRE tags
  addMitreTag: (docId: string, techniqueId: string) =>
    api
      .post<MitreTagResponse>(
        `/linking/kb/documents/${docId}/mitre-tags`,
        { technique_id: techniqueId }
      )
      .then((r) => r.data),

  removeMitreTag: (docId: string, techniqueId: string) =>
    api
      .delete<MitreTagResponse>(
        `/linking/kb/documents/${docId}/mitre-tags/${techniqueId}`
      )
      .then((r) => r.data),

  // MITRE technique lookup
  listMitreTechniques: (q?: string) => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    return api
      .get<MitreTechnique[]>('/linking/mitre/techniques', { params })
      .then((r) => r.data);
  },
};
