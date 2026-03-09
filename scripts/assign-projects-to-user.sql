-- Assign all projects to jparido@mcwcompanies.com
-- Run in Supabase Dashboard → SQL Editor (paste and run)

UPDATE takeoff_projects
SET user_id = (
  SELECT id FROM auth.users
  WHERE email = 'jparido@mcwcompanies.com'
  LIMIT 1
);

-- Verify: both projects should show your user_id
SELECT id, name, user_id, created_at
FROM takeoff_projects
ORDER BY last_modified DESC;
