export type ProjectType = 'htb' | 'thm' | 'real' | 'ctf' | 'custom'

export interface ProjectVariables {
  target_ip?: string
  target_domain?: string
  attacker_ip?: string
  attacker_port?: string
  [key: string]: string | undefined
}

export interface Project {
  id: string
  name: string
  type: ProjectType
  status: 'active' | 'paused' | 'completed'
  variables: ProjectVariables
  slug: string
  workspace_path: string
  created_at: string
  updated_at: string
}

export interface ProjectVpnStatus {
  platform_id: string
  platform_label: string
  button_label: string
  state: 'connected' | 'disconnected' | 'missing' | 'unknown'
  command?: string | null
  disconnect_command?: string | null
  config_path: string
  source_label: string
  reason?: string | null
  connected_process_pid?: number | null
  connected_process_name?: string | null
  connected_process_command?: string | null
}

export interface CreateProjectInput {
  name: string
  type?: string
  status?: string
  variables?: ProjectVariables
  workspace_base?: string
}

export interface UpdateProjectInput {
  name?: string
  type?: string
  status?: string
  variables?: ProjectVariables
}

export interface UserProfile {
  id: string
  username: string
  email?: string | null
  display_name?: string | null
  team?: string | null
  timezone?: string | null
  signature?: string | null
  language?: string | null
  notifications?: Record<string, boolean> | null
  shortcuts?: Record<string, string> | null
  is_super_admin: boolean
}

export interface Settings {
  workspace_base_path?: string | null
  vault_path?: string | null
  vpn_path?: string | null
  vpn_content?: string | null
  vpn_platform_defaults?: Record<string, VpnPlatformProfile> | null
  report_evaluation_lease_seconds?: number | null
  report_evaluation_heartbeat_interval_seconds?: number | null
  report_evaluation_reclaim_poll_interval_seconds?: number | null
  report_evaluation_max_runtime_seconds?: number | null
}

export interface VpnPlatformProfile {
  label?: string | null
  config_path?: string | null
  connect_command?: string | null
  file_name?: string | null
  managed?: boolean | null
  disabled?: boolean | null
  uploaded_file_name?: string | null
  uploaded_file_content?: string | null
  has_api_token?: boolean | null
  api_token?: string | null
  clear_api_token?: boolean | null
}

export interface Membership {
  id: string
  user_id: string
  project_id: string
  role: 'admin' | 'member'
  status: 'active' | 'pending' | 'denied'
  source: 'invite' | 'request'
  username?: string | null
  display_name?: string | null
  email?: string | null
  team?: string | null
}
