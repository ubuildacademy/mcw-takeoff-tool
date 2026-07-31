-- Task I6 — link a takeoff condition to an assembly and ONE of its named
-- quantity inputs.
--
-- Two columns, not one. An assembly like "Aquafin-2K M" prices several named
-- inputs (SF-Floor, SF-Wall, LF-Cove); a condition measures exactly one of
-- them. Storing only the assembly would leave the engine guessing which input
-- the takeoff quantity feeds, and guessing wrong prices the wrong components.
--
-- Both are ON DELETE SET NULL rather than CASCADE: deleting an assembly from
-- the library must not delete a project's takeoff. The condition survives,
-- unlinked, with its quantities intact.

ALTER TABLE takeoff_conditions
  ADD COLUMN IF NOT EXISTS assembly_id UUID REFERENCES assemblies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assembly_quantity_input_id UUID
    REFERENCES assembly_quantity_inputs(id) ON DELETE SET NULL;

COMMENT ON COLUMN takeoff_conditions.assembly_id IS
  'Assembly this condition is priced by. NULL means the condition uses its own flat material/labor costs.';
COMMENT ON COLUMN takeoff_conditions.assembly_quantity_input_id IS
  'Which of the assembly''s named quantity inputs this condition''s takeoff quantity feeds.';

-- Costs-tab pricing loads every linked condition for a project at once.
CREATE INDEX IF NOT EXISTS idx_takeoff_conditions_assembly
  ON takeoff_conditions (assembly_id)
  WHERE assembly_id IS NOT NULL;

-- The input must belong to the assembly it is paired with. Postgres cannot
-- express that as a foreign key across two tables, so it is a trigger. Without
-- it a condition could point at another assembly's input and price a component
-- set that has nothing to do with the measurement.
--
-- An input with no assembly is CLEARED rather than rejected. That case is not
-- hypothetical: deleting an assembly fires the ON DELETE SET NULL above, which
-- nulls assembly_id and re-fires this trigger while the input id is still set.
-- Raising there would make deleting any linked assembly fail outright. Clearing
-- is also the right answer on its own terms — an input id without an assembly
-- prices nothing, and leaving it behind would let it re-attach to whatever
-- assembly the condition is linked to next.
CREATE OR REPLACE FUNCTION assert_condition_input_belongs_to_assembly()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assembly_quantity_input_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.assembly_id IS NULL THEN
    NEW.assembly_quantity_input_id := NULL;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM assembly_quantity_inputs
    WHERE id = NEW.assembly_quantity_input_id
      AND assembly_id = NEW.assembly_id
  ) THEN
    RAISE EXCEPTION 'quantity input % does not belong to assembly %',
      NEW.assembly_quantity_input_id, NEW.assembly_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_condition_input_belongs_to_assembly ON takeoff_conditions;
CREATE TRIGGER trg_condition_input_belongs_to_assembly
  BEFORE INSERT OR UPDATE OF assembly_id, assembly_quantity_input_id ON takeoff_conditions
  FOR EACH ROW EXECUTE FUNCTION assert_condition_input_belongs_to_assembly();
