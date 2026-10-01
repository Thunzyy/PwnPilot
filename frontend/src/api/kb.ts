import { api } from './client';
import { measureKBPerfAsync } from "../lib/perf/kbPerf";
import type {
  KBAddCustomGitRequest,
  KBAddCommunityRequest,
  KBBookmark,
  KBBulkTagEditResponse,
  KBCatalogEntry,
  KBDocCreate,
  KBDocDetail,
  KBDocListResponse,
  KBDocRenameResponse,
  KBDocUpdate,
  KBSearchResponse,
  KBSource,
  KBSourceCreate,
  KBSourceUpdate,
  KBTagInfo,
  KBTagOperationResponse,
  KBTaskStatus,
  KBTreeNode,
  PathValidationResult,
  SearchSortBy,
  SearchSortDir,
} from '../types/kb';

export const kbApi = {
  // Search
  search: (q: string, sourceId?: string, limit?: number, sortBy?: SearchSortBy, sortDir?: SearchSortDir) => {
    const params: Record<string, string | number> = { q };
    if (sourceId) params.source_id = sourceId;
    if (limit) params.limit = limit;
    if (sortBy) params.sort_by = sortBy;
    if (sortDir) params.sort_dir = sortDir;
    return measureKBPerfAsync(
      "kb.search",
      () => api.get<KBSearchResponse>('/kb/search', { params }).then(r => r.data),
      {
        metadata: {
          sourceId,
          queryLength: q.length,
          limit,
          sortBy,
          sortDir,
        },
        onSuccess: (response) => ({
          resultCount: response.items.length,
          total: response.total,
        }),
      }
    );
  },

  // Tags (autocomplete)
  getTags: (sourceId?: string) => {
    const params: Record<string, string> = {};
    if (sourceId) params.source_id = sourceId;
    return api.get<KBTagInfo[]>('/kb/tags', { params }).then(r => r.data);
  },

  renameTag: (oldTag: string, newTag: string) =>
    api.post<KBTagOperationResponse>('/kb/tags/rename', { old_tag: oldTag, new_tag: newTag })
      .then(r => r.data),

  deleteTag: (tag: string) =>
    api.post<KBTagOperationResponse>('/kb/tags/delete', { tag })
      .then(r => r.data),

  bulkEditTags: (docIds: string[], addTags: string[], removeTags: string[]) =>
    api.post<KBBulkTagEditResponse>('/kb/tags/bulk-edit', {
      doc_ids: docIds, add_tags: addTags, remove_tags: removeTags,
    }).then(r => r.data),

  // Documents
  listDocuments: (sourceId?: string, cursor?: string, limit?: number, tag?: string) => {
    const params: Record<string, string | number> = {};
    if (sourceId) params.source_id = sourceId;
    if (cursor) params.cursor = cursor;
    if (limit) params.limit = limit;
    if (tag) params.tag = tag;
    return api.get<KBDocListResponse>('/kb/documents', { params }).then(r => r.data);
  },

  getDocument: (docId: string) =>
    measureKBPerfAsync(
      "kb.document.open",
      () => api.get<KBDocDetail>(`/kb/documents/${docId}`).then(r => r.data),
      {
        metadata: { docId },
        onSuccess: (doc) => ({
          sourceId: doc.source_id,
        }),
      }
    ),

  updateDocument: (docId: string, data: KBDocUpdate) =>
    api.put<KBDocDetail>(`/kb/documents/${docId}`, data).then(r => r.data),

  createDocument: (data: KBDocCreate) =>
    api.post<KBDocDetail>('/kb/documents', data).then(r => r.data),

  renameDocument: (docId: string, newTitle: string) =>
    api.post<KBDocRenameResponse>(`/kb/documents/${docId}/rename`, { new_title: newTitle })
      .then(r => r.data),

  deleteDocument: (docId: string) =>
    api.delete(`/kb/documents/${docId}`),

  getTree: (sourceId?: string, tag?: string) => {
    const params: Record<string, string> = {};
    if (sourceId) params.source_id = sourceId;
    if (tag) params.tag = tag;
    return measureKBPerfAsync(
      "kb.tree",
      () => api.get<KBTreeNode>('/kb/documents/tree', { params }).then(r => r.data),
      {
        metadata: { sourceId, tag },
      }
    );
  },

  createFolder: (sourceId: string, folderPath: string) =>
    api.post<{ folder_path: string; created: boolean }>(
      `/kb/sources/${sourceId}/folders`,
      { folder_path: folderPath },
    ).then(r => r.data),

  // Sources
  listSources: (projectId?: string) => {
    const params = projectId ? { project_id: projectId } : {};
    return measureKBPerfAsync(
      "kb.sources.list",
      () => api.get<KBSource[]>('/kb/sources', { params }).then(r => r.data),
      {
        metadata: { projectId: projectId ?? null },
        onSuccess: (sources) => ({
          resultCount: sources.length,
        }),
      }
    );
  },

  getSource: (sourceId: string) =>
    api.get<KBSource>(`/kb/sources/${sourceId}`).then(r => r.data),

  createSource: (data: KBSourceCreate) =>
    api.post<KBSource>('/kb/sources', data).then(r => r.data),

  updateSource: (sourceId: string, data: KBSourceUpdate) =>
    api.patch<KBSource>(`/kb/sources/${sourceId}`, data).then(r => r.data),

  addCommunitySource: (data: KBAddCommunityRequest) =>
    api.post<KBSource>('/kb/sources/community', data).then(r => r.data),

  addCustomGitSource: (data: KBAddCustomGitRequest) =>
    api.post<KBSource>('/kb/sources/community/custom', data).then(r => r.data),

  deleteSource: (sourceId: string) =>
    api.delete(`/kb/sources/${sourceId}`),

  deleteSourceWithFiles: (sourceId: string, deleteFiles: boolean) =>
    api.delete(`/kb/sources/${sourceId}`, { params: deleteFiles ? { delete_files: true } : {} }),

  // Index tasks
  triggerIndex: (sourceId: string) =>
    api.post<{ task_id: string; status: string }>(`/kb/sources/${sourceId}/index`).then(r => r.data),

  getIndexStatus: (taskId: string) =>
    api.get<KBTaskStatus>(`/kb/index-tasks/${taskId}`).then(r => r.data),

  // Sync tasks
  triggerSync: (sourceId: string) =>
    api.post<{ task_id: string; status: string }>(`/kb/sources/${sourceId}/sync`).then(r => r.data),

  getSyncStatus: (taskId: string) =>
    api.get<KBTaskStatus>(`/kb/sync-tasks/${taskId}`).then(r => r.data),

  // Community catalog
  getCatalog: () =>
    api.get<KBCatalogEntry[]>('/kb/community-catalog').then(r => r.data),

  // Bookmarks
  listBookmarks: () =>
    api.get<KBBookmark[]>('/kb/bookmarks').then(r => r.data),

  addBookmark: (docId: string) =>
    api.post<KBBookmark>('/kb/bookmarks', { doc_id: docId }).then(r => r.data),

  removeBookmark: (docId: string) =>
    api.delete(`/kb/bookmarks/${docId}`),

  // Settings / path validation
  validatePath: (path: string) =>
    api.get<PathValidationResult>('/settings/validate-path', { params: { path } }).then(r => r.data),
};
