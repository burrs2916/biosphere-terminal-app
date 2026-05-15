export interface ConnectionConfig {
  id: string;
  name: string;
  connection_type: string;
  config_json: string;
  created_at: number;
}

export interface SshConnectionInfo {
  host: string;
  port: number;
  username: string;
  auth_method: 'none' | 'password' | 'private_key';
  private_key_path?: string;
  password?: string;
}
