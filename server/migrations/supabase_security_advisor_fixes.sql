-- Migration: Address Supabase Security Advisor warnings
-- 1. Function search_path mutable (public.is_admin, public.update_ocr_training_data_*)
-- 2. RLS policy always true on public.ocr_training_data
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.

-- =============================================================================
-- 1. Fix function search_path (prevents schema injection / unexpected resolution)
-- =============================================================================

-- Fix search_path for public.is_admin if it exists (any signature)
DO $$
DECLARE
  r RECORD;
  sig TEXT;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'is_admin'
  LOOP
    sig := format('%I.%I(%s)', 'public', r.proname, r.args);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', sig);
    RAISE NOTICE 'Set search_path for function %', sig;
  END LOOP;
END $$;

-- Fix search_path for any function whose name starts with update_ocr_training_data (Security Advisor truncates the name)
DO $$
DECLARE
  r RECORD;
  sig TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname LIKE 'update_ocr_training_data%'
  LOOP
    sig := format('%I.%I(%s)', 'public', r.proname, r.args);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', sig);
    RAISE NOTICE 'Set search_path for function %', sig;
  END LOOP;
END $$;

-- =============================================================================
-- 2. Fix RLS on ocr_training_data (replace "always true" with authenticated-only)
-- =============================================================================

-- Drop existing policies on ocr_training_data (removes the overly permissive one)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ocr_training_data'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ocr_training_data', pol.policyname);
  END LOOP;
END $$;

-- Ensure RLS is enabled
ALTER TABLE public.ocr_training_data ENABLE ROW LEVEL SECURITY;

-- New policy: only authenticated users can read/write (no anon or public access)
-- Tighten further if this table has project_id: e.g. USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()) OR (SELECT role FROM user_metadata WHERE id = auth.uid()) = 'admin')
CREATE POLICY "ocr_training_data_authenticated_only"
  ON public.ocr_training_data
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
