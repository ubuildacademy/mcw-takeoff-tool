-- Migration: brand on assemblies + strip multer UUIDs from already-imported names
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- Two fixes that belong together because both are about making a 200+ library
-- readable:
--
-- 1. `brand` — MCW's source folder is organised by manufacturer (Aquafin/,
--    Tremco/, Sika/…). The pickers group on this column. NULL means
--    uncategorised, which is what a company that builds assemblies by hand
--    (no folder tree) gets until they set one.
--
-- 2. UUID strip — uploads land as a temp file named `${uuid}-${originalname}`,
--    and until 2026-07-31 the extractor derived the proposed name from that
--    temp path. Anything imported before then is stored as
--    "697d5e88-…-250GC Retaining wall 5 Year". The import path is fixed; this
--    cleans the existing rows.
--
-- After the UUID strip, the three Tremco 250 GC assemblies already in the
-- library get brand = 'Tremco' so they land in the right group without a
-- re-import. Idempotent: a second run updates nothing that is already clean.

ALTER TABLE assemblies
  ADD COLUMN IF NOT EXISTS brand TEXT;

COMMENT ON COLUMN assemblies.brand IS
  'Manufacturer / product line for grouping in pickers (e.g. Tremco, Sika). NULL = uncategorised.';

CREATE INDEX IF NOT EXISTS idx_assemblies_org_brand
  ON assemblies (org_id, brand);

-- Strip the upload UUID prefix. Matches assemblyNameFromFilename's pattern:
-- a UUID is 8-4-4-4-12 hex, so no real assembly name can begin with one
-- followed by a hyphen.
UPDATE assemblies
SET name = btrim(
      regexp_replace(
        name,
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-',
        '',
        'i'
      )
    )
WHERE name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-'
  AND btrim(
        regexp_replace(
          name,
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-',
          '',
          'i'
        )
      ) <> '';

-- The three assemblies imported before brand existed are all Tremco 250 GC.
UPDATE assemblies
SET brand = 'Tremco'
WHERE brand IS NULL
  AND (name ILIKE '%250%GC%' OR name ILIKE '%250GC%');

DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM assemblies
  WHERE name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-'
    AND btrim(
          regexp_replace(
            name,
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-',
            '',
            'i'
          )
        ) <> '';
  IF remaining > 0 THEN
    RAISE EXCEPTION '% assembly name(s) still carry an upload UUID prefix', remaining;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assemblies' AND column_name = 'brand'
  ) THEN
    RAISE EXCEPTION 'assemblies.brand column was not created';
  END IF;
END $$;
