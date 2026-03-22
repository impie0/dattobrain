-- Default users (password: secret — bcrypt hash of "secret" with 12 rounds)
-- Hash: $2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW
INSERT INTO users (username, email, password_hash) VALUES
  ('admin_user',    'admin@example.com',    '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW'),
  ('analyst_user',  'analyst@example.com',  '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW'),
  ('helpdesk_user', 'helpdesk@example.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW'),
  ('readonly_user', 'readonly@example.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW')
ON CONFLICT (username) DO NOTHING;

-- Roles
INSERT INTO roles (name, description) VALUES
  ('admin',    'Full access to all tools and administration'),
  ('analyst',  'Access to devices, sites, alerts, jobs, and activity logs'),
  ('helpdesk', 'Access to devices and alerts for support tasks'),
  ('readonly', 'Read-only access to sites and system status')
ON CONFLICT (name) DO NOTHING;

-- Tool permissions — analyst
INSERT INTO tool_permissions (role_id, tool_name)
SELECT r.id, t.tool_name
FROM roles r, (VALUES
  ('list-devices'),
  ('get-device'),
  ('list-sites'),
  ('get-site'),
  ('list-open-alerts'),
  ('list-resolved-alerts'),
  ('get-alert'),
  ('get-job'),
  ('get-activity-logs')
) AS t(tool_name)
WHERE r.name = 'analyst'
ON CONFLICT (role_id, tool_name) DO NOTHING;

-- Tool permissions — helpdesk
INSERT INTO tool_permissions (role_id, tool_name)
SELECT r.id, t.tool_name
FROM roles r, (VALUES
  ('list-devices'),
  ('get-device'),
  ('list-open-alerts'),
  ('list-resolved-alerts'),
  ('get-alert')
) AS t(tool_name)
WHERE r.name = 'helpdesk'
ON CONFLICT (role_id, tool_name) DO NOTHING;

-- Tool permissions — readonly
INSERT INTO tool_permissions (role_id, tool_name)
SELECT r.id, t.tool_name
FROM roles r, (VALUES
  ('list-sites'),
  ('get-system-status'),
  ('get-rate-limit'),
  ('get-pagination-config')
) AS t(tool_name)
WHERE r.name = 'readonly'
ON CONFLICT (role_id, tool_name) DO NOTHING;

-- Tool permissions — semantic-search (all roles — local vector search, no MCP required)
INSERT INTO tool_permissions (role_id, tool_name)
SELECT id, 'semantic-search' FROM roles
ON CONFLICT (role_id, tool_name) DO NOTHING;

-- Tool permissions — Stage 3 MV tools (all roles — read-only fleet overview)
INSERT INTO tool_permissions (role_id, tool_name)
SELECT r.id, t.tool_name
FROM roles r, (VALUES
  ('get-fleet-status'),
  ('list-site-summaries'),
  ('list-critical-alerts')
) AS t(tool_name)
ON CONFLICT (role_id, tool_name) DO NOTHING;

-- Tool permissions — admin (all tools)
INSERT INTO tool_permissions (role_id, tool_name)
SELECT r.id, t.tool_name
FROM roles r, (VALUES
  ('get-account'),
  ('list-sites'),
  ('list-devices'),
  ('list-users'),
  ('list-account-variables'),
  ('list-components'),
  ('list-open-alerts'),
  ('list-resolved-alerts'),
  ('get-site'),
  ('list-site-devices'),
  ('list-site-open-alerts'),
  ('list-site-resolved-alerts'),
  ('list-site-variables'),
  ('get-site-settings'),
  ('list-site-filters'),
  ('get-device'),
  ('get-device-by-id'),
  ('get-device-by-mac'),
  ('list-device-open-alerts'),
  ('list-device-resolved-alerts'),
  ('get-alert'),
  ('get-job'),
  ('get-job-components'),
  ('get-job-results'),
  ('get-job-stdout'),
  ('get-job-stderr'),
  ('get-device-audit'),
  ('get-device-software'),
  ('get-device-audit-by-mac'),
  ('get-esxi-audit'),
  ('get-printer-audit'),
  ('get-activity-logs'),
  ('list-default-filters'),
  ('list-custom-filters'),
  ('get-system-status'),
  ('get-rate-limit'),
  ('get-pagination-config'),
  ('semantic-search'),
  ('get-fleet-status'),
  ('list-site-summaries'),
  ('list-critical-alerts')
) AS t(tool_name)
WHERE r.name = 'admin'
ON CONFLICT (role_id, tool_name) DO NOTHING;

-- Assign roles to default users
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE (u.username = 'admin_user'    AND r.name = 'admin')
   OR (u.username = 'analyst_user'  AND r.name = 'analyst')
   OR (u.username = 'helpdesk_user' AND r.name = 'helpdesk')
   OR (u.username = 'readonly_user' AND r.name = 'readonly')
ON CONFLICT (user_id, role_id) DO NOTHING;
