import type { KBSource } from "@/types/kb";

export function makeSource(overrides?: Partial<KBSource>): KBSource {
  return {
    id: "src-1",
    name: "Test Vault",
    source_type: "local",
    origin: "filesystem",
    path: "/home/user/vault",
    remote_url: null,
    read_only: false,
    include_paths: null,
    user_id: "u1",
    project_id: "p1",
    sync_status: null,
    opsec_warning: null,
    opsec_acknowledged: false,
    last_synced_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
