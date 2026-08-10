CREATE TABLE IF NOT EXISTS strategic_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid REFERENCES departments(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'Ativo',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid REFERENCES departments(id),
  objective_id uuid REFERENCES strategic_objectives(id),
  name text NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  owner_user_id uuid REFERENCES users(id),
  manager_user_id uuid REFERENCES users(id),
  sponsor_user_id uuid REFERENCES users(id),
  progress numeric(5,2),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL REFERENCES users(id),
  assignment_role text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  delegated_by uuid REFERENCES users(id),
  reason text
);

CREATE TABLE IF NOT EXISTS project_workstreams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL,
  owner_user_id uuid REFERENCES users(id),
  status text NOT NULL,
  due_date date,
  progress numeric(5,2),
  notes text
);

CREATE TABLE IF NOT EXISTS project_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  workstream_id uuid REFERENCES project_workstreams(id),
  owner_user_id uuid REFERENCES users(id),
  department_id uuid REFERENCES departments(id),
  title text NOT NULL,
  starts_at date,
  due_at date,
  status text NOT NULL,
  priority text,
  progress numeric(5,2),
  indicator_id uuid,
  dependency_id uuid REFERENCES project_actions(id),
  notes text
);

CREATE TABLE IF NOT EXISTS project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL,
  target_date date,
  completed_date date,
  status text NOT NULL,
  owner_user_id uuid REFERENCES users(id),
  expected_result text
);

CREATE TABLE IF NOT EXISTS project_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL,
  probability text,
  impact text,
  level text,
  owner_user_id uuid REFERENCES users(id),
  mitigation_plan text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  value numeric(18,4),
  unit text NOT NULL,
  source text,
  calculated_at timestamptz,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS project_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  indicator_id uuid NOT NULL REFERENCES project_indicators(id),
  baseline numeric(18,4),
  target_value numeric(18,4),
  due_date date,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  levels jsonb NOT NULL DEFAULT '[]',
  parameters jsonb NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recovery_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  process_id uuid,
  internalization_status text NOT NULL,
  current_firm text,
  lawyer text,
  analysis_date date,
  decision_reason text,
  decided_by uuid REFERENCES users(id),
  internalized_at date,
  prior_external_cost numeric(18,2),
  estimated_internal_cost numeric(18,2),
  recovery_potential numeric(18,2),
  notes text,
  UNIQUE(project_id, process_id)
);

CREATE TABLE IF NOT EXISTS recovery_negotiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  recovery_case_id uuid REFERENCES recovery_cases(id),
  owner_user_id uuid REFERENCES users(id),
  status text NOT NULL,
  proposal jsonb NOT NULL DEFAULT '{}',
  last_contact_at timestamptz,
  next_action_at timestamptz,
  response_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legal_negotiation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  recovery_case_id uuid REFERENCES recovery_cases(id),
  lawyer text,
  firm text,
  contacted_at timestamptz NOT NULL,
  channel text,
  subject text NOT NULL,
  discussed_proposal jsonb,
  recommendation text,
  decision text,
  internal_owner_id uuid REFERENCES users(id),
  next_step text,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_recovery_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) UNIQUE,
  version integer NOT NULL DEFAULT 1,
  internalization_statuses jsonb NOT NULL DEFAULT '[]',
  internalization_criteria jsonb NOT NULL DEFAULT '[]',
  aging_bands jsonb NOT NULL DEFAULT '[]',
  honorarium_policies jsonb NOT NULL DEFAULT '[]',
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_management_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  source_entity text NOT NULL,
  source_id text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'Pendente',
  approval_rule_id uuid REFERENCES project_approval_rules(id),
  assigned_to uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users(id),
  justification text
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(manager_user_id);
CREATE INDEX IF NOT EXISTS idx_project_actions_project ON project_actions(project_id);
CREATE INDEX IF NOT EXISTS idx_recovery_cases_process ON recovery_cases(process_id);
CREATE INDEX IF NOT EXISTS idx_management_pending ON project_management_items(project_id, status);
