import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, recordKBPerfSampleMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  recordKBPerfSampleMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: apiMock,
  API_BASE_URL: "http://localhost:8000",
}));

vi.mock("../lib/perf/kbPerf", () => ({
  recordKBPerfSample: recordKBPerfSampleMock,
  measureKBPerfAsync: async (
    operation: string,
    run: () => Promise<unknown>,
    options?: {
      metadata?: Record<string, unknown>;
      onSuccess?: (result: unknown) => Record<string, unknown> | undefined;
      onError?: (error: unknown) => Record<string, unknown> | undefined;
    }
  ) => {
    try {
      const result = await run();
      recordKBPerfSampleMock({
        operation,
        durationMs: 1,
        status: "success",
        metadata: {
          ...options?.metadata,
          ...options?.onSuccess?.(result),
        },
      });
      return result;
    } catch (error) {
      recordKBPerfSampleMock({
        operation,
        durationMs: 1,
        status: "error",
        metadata: {
          ...options?.metadata,
          ...options?.onError?.(error),
        },
      });
      throw error;
    }
  },
}));

import { kbApi } from "../api/kb";

describe("kbApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  describe("search", () => {
    it("calls GET /kb/search with query param", async () => {
      const payload = { items: [], query: "nmap", total: 0 };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.search("nmap");

      expect(apiMock.get).toHaveBeenCalledWith("/kb/search", {
        params: { q: "nmap" },
      });
      expect(result).toEqual(payload);
    });

    it("includes optional source_id and limit when provided", async () => {
      const payload = { items: [], query: "nmap", total: 0 };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      await kbApi.search("nmap", "src-1", 5);

      expect(apiMock.get).toHaveBeenCalledWith("/kb/search", {
        params: { q: "nmap", source_id: "src-1", limit: 5 },
      });
    });

    it("returns unwrapped response data", async () => {
      const payload = { items: [{ id: "d1" }], query: "nmap", total: 1 };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.search("nmap");
      expect(result).toEqual(payload);
      expect(result).not.toHaveProperty("data");
    });

    it("records a perf sample for successful searches", async () => {
      const payload = { items: [{ id: "d1" }, { id: "d2" }], query: "nmap", total: 2 };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      await kbApi.search("nmap", "src-1", 20);

      expect(recordKBPerfSampleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "kb.search",
          status: "success",
          metadata: expect.objectContaining({
            sourceId: "src-1",
            queryLength: 4,
            resultCount: 2,
            total: 2,
            limit: 20,
          }),
        })
      );
    });

    it("records a perf sample when search fails", async () => {
      apiMock.get.mockRejectedValueOnce(new Error("Search exploded"));

      await expect(kbApi.search("nmap")).rejects.toThrow("Search exploded");

      expect(recordKBPerfSampleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "kb.search",
          status: "error",
          metadata: expect.objectContaining({
            queryLength: 4,
          }),
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------------
  describe("documents", () => {
    it("listDocuments calls GET /kb/documents with no params by default", async () => {
      const payload = { items: [], next_cursor: null, has_more: false };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.listDocuments();

      expect(apiMock.get).toHaveBeenCalledWith("/kb/documents", {
        params: {},
      });
      expect(result).toEqual(payload);
    });

    it("listDocuments passes optional source_id, cursor, limit", async () => {
      const payload = { items: [], next_cursor: null, has_more: false };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      await kbApi.listDocuments("src-1", "abc123", 20);

      expect(apiMock.get).toHaveBeenCalledWith("/kb/documents", {
        params: { source_id: "src-1", cursor: "abc123", limit: 20 },
      });
    });

    it("getDocument calls GET /kb/documents/{docId}", async () => {
      const payload = { id: "doc-1", title: "Nmap Guide" };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.getDocument("doc-1");

      expect(apiMock.get).toHaveBeenCalledWith("/kb/documents/doc-1");
      expect(result).toEqual(payload);
    });

    it("records a perf sample for document opens", async () => {
      const payload = { id: "doc-1", title: "Nmap Guide" };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      await kbApi.getDocument("doc-1");

      expect(recordKBPerfSampleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "kb.document.open",
          status: "success",
          metadata: expect.objectContaining({
            docId: "doc-1",
          }),
        })
      );
    });

    it("getTree calls GET /kb/documents/tree with no params by default", async () => {
      const payload = { name: "root", type: "folder", children: [], docs: [] };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.getTree();

      expect(apiMock.get).toHaveBeenCalledWith("/kb/documents/tree", {
        params: {},
      });
      expect(result).toEqual(payload);
    });

    it("getTree passes optional source_id", async () => {
      const payload = { name: "root", type: "folder", children: [], docs: [] };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      await kbApi.getTree("src-1");

      expect(apiMock.get).toHaveBeenCalledWith("/kb/documents/tree", {
        params: { source_id: "src-1" },
      });
    });

    it("records a perf sample for tree fetches", async () => {
      const payload = { name: "root", type: "folder", children: [], docs: [] };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      await kbApi.getTree("src-1", "tag:red");

      expect(recordKBPerfSampleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "kb.tree",
          status: "success",
          metadata: expect.objectContaining({
            sourceId: "src-1",
            tag: "tag:red",
          }),
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------
  describe("sources", () => {
    it("listSources calls GET /kb/sources with no params by default", async () => {
      apiMock.get.mockResolvedValueOnce({ data: [] });

      const result = await kbApi.listSources();

      expect(apiMock.get).toHaveBeenCalledWith("/kb/sources", { params: {} });
      expect(result).toEqual([]);
    });

    it("listSources passes optional project_id", async () => {
      apiMock.get.mockResolvedValueOnce({ data: [] });

      await kbApi.listSources("proj-1");

      expect(apiMock.get).toHaveBeenCalledWith("/kb/sources", {
        params: { project_id: "proj-1" },
      });
    });

    it("records a perf sample for source listing", async () => {
      apiMock.get.mockResolvedValueOnce({ data: [{ id: "src-1" }, { id: "src-2" }] });

      await kbApi.listSources("proj-1");

      expect(recordKBPerfSampleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "kb.sources.list",
          status: "success",
          metadata: expect.objectContaining({
            projectId: "proj-1",
            resultCount: 2,
          }),
        })
      );
    });

    it("getSource calls GET /kb/sources/{sourceId}", async () => {
      const payload = { id: "src-1", name: "Notes" };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.getSource("src-1");

      expect(apiMock.get).toHaveBeenCalledWith("/kb/sources/src-1");
      expect(result).toEqual(payload);
    });

    it("createSource calls POST /kb/sources with body", async () => {
      const body = { name: "My Notes", project_id: "proj-1" };
      const payload = { id: "src-new", ...body };
      apiMock.post.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.createSource(body);

      expect(apiMock.post).toHaveBeenCalledWith("/kb/sources", body);
      expect(result).toEqual(payload);
    });

    it("addCommunitySource calls POST /kb/sources/community with body", async () => {
      const body = { project_id: "proj-1", slug: "hacktricks" };
      const payload = { id: "src-comm", name: "HackTricks" };
      apiMock.post.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.addCommunitySource(body);

      expect(apiMock.post).toHaveBeenCalledWith(
        "/kb/sources/community",
        body
      );
      expect(result).toEqual(payload);
    });
  });

  // ---------------------------------------------------------------------------
  // Tasks (index + sync)
  // ---------------------------------------------------------------------------
  describe("tasks", () => {
    it("triggerIndex calls POST /kb/sources/{sourceId}/index", async () => {
      const payload = { task_id: "t-1", status: "pending" };
      apiMock.post.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.triggerIndex("src-1");

      expect(apiMock.post).toHaveBeenCalledWith("/kb/sources/src-1/index");
      expect(result).toEqual(payload);
    });

    it("getIndexStatus calls GET /kb/index-tasks/{taskId}", async () => {
      const payload = { task_id: "t-1", status: "completed" };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.getIndexStatus("t-1");

      expect(apiMock.get).toHaveBeenCalledWith("/kb/index-tasks/t-1");
      expect(result).toEqual(payload);
    });

    it("triggerSync calls POST /kb/sources/{sourceId}/sync", async () => {
      const payload = { task_id: "t-2", status: "pending" };
      apiMock.post.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.triggerSync("src-1");

      expect(apiMock.post).toHaveBeenCalledWith("/kb/sources/src-1/sync");
      expect(result).toEqual(payload);
    });

    it("getSyncStatus calls GET /kb/sync-tasks/{taskId}", async () => {
      const payload = { task_id: "t-2", status: "running" };
      apiMock.get.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.getSyncStatus("t-2");

      expect(apiMock.get).toHaveBeenCalledWith("/kb/sync-tasks/t-2");
      expect(result).toEqual(payload);
    });
  });

  // ---------------------------------------------------------------------------
  // Community catalog
  // ---------------------------------------------------------------------------
  describe("catalog", () => {
    it("getCatalog calls GET /kb/community-catalog", async () => {
      const payload = [{ slug: "hacktricks", name: "HackTricks" }];
      apiMock.get.mockResolvedValueOnce({ data: payload });

      const result = await kbApi.getCatalog();

      expect(apiMock.get).toHaveBeenCalledWith("/kb/community-catalog");
      expect(result).toEqual(payload);
    });
  });
});
