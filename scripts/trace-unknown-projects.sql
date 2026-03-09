-- Trace "Unknown Owner" projects + RECOVERY
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
--
-- Projects show under "Unknown Owner" when user_id is NULL.
--
-- Prevention (already fixed in code):
-- - server: storage.saveProject uses defaultToNull: false on upsert
-- - server: performImportFromBackup strips user_id from backup, always sets current user
-- - client: supabaseService.updateProject never includes user_id in updates
-- - DB: Run server/migrations/ensure_project_user_id_not_null.sql to enforce NOT NULL
--
-- RECOVERY OPTIONS:
-- 1. Supabase Dashboard → Database → Backups: use point-in-time recovery if available
-- 2. Manual reassignment below (you'll need to know which user owned which project)

-- 1. List all projects with null user_id (the "Unknown Owner" projects)
SELECT 
  id,
  name,
  client,
  created_at,
  last_modified
FROM takeoff_projects
WHERE user_id IS NULL
ORDER BY created_at DESC;

-- 2. If you want to match by project NAME to invites, run this (replace names as needed):
--    Recent project-share invites include project_name when someone shared via email
SELECT 
  ui.id,
  ui.email,
  ui.source,
  ui.project_name,
  ui.status,
  ui.created_at,
  ui.invited_by
FROM user_invitations ui
WHERE ui.source = 'project_share'
  AND ui.created_at >= NOW() - INTERVAL '7 days'
ORDER BY ui.created_at DESC;

-- 3. Combined: projects with null user_id + invites that might match by project name
WITH unknown_projects AS (
  SELECT id, name, created_at FROM takeoff_projects WHERE user_id IS NULL
)
SELECT 
  up.id AS project_id,
  up.name AS project_name,
  up.created_at AS project_created,
  ui.email,
  ui.source,
  ui.status AS invite_status,
  ui.created_at AS invite_created
FROM unknown_projects up
LEFT JOIN user_invitations ui 
  ON LOWER(TRIM(ui.project_name)) = LOWER(TRIM(up.name))
  AND ui.source = 'project_share'
  AND ui.created_at >= up.created_at - INTERVAL '1 day'
  AND ui.created_at <= up.created_at + INTERVAL '1 day'
ORDER BY up.created_at DESC, ui.created_at DESC;

-- 4. RECOVERY: List users so you can map projects back (run first to get user IDs)
SELECT id, raw_user_meta_data->>'email' AS email, raw_user_meta_data->>'full_name' AS name
FROM auth.users
ORDER BY email;

-- 5. RECOVERY: Reassign projects to correct owner (edit the values and run)
-- Example: assign projects by name pattern or individual IDs
-- UPDATE takeoff_projects SET user_id = 'USER_UUID_HERE' WHERE name = 'Project Name';
-- UPDATE takeoff_projects SET user_id = 'USER_UUID_HERE' WHERE id IN ('proj-id-1', 'proj-id-2');
