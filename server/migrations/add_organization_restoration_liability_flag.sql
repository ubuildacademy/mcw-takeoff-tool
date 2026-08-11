-- Item 18 (OPEN_ITEMS.md): the "restoration liability rate" toggle on the Costs
-- tab is MCW-specific accounting language (waterproofing vs. restoration
-- liability basis for the budget report) and was showing for every company.
--
-- Gate it per-org, same shape as assemblies_enabled, defaulted off and turned
-- on only for MCW.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS restoration_liability_enabled BOOLEAN NOT NULL DEFAULT false;

UPDATE organizations
SET restoration_liability_enabled = true
WHERE name = 'MCW Companies';
