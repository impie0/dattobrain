CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS tool_permissions (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id   UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  UNIQUE (role_id, tool_name)
);
