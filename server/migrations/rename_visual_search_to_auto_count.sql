-- Migration: Rename visual-search to auto-count and add searchScope field
-- Date: 2025-01-XX
-- Description: 
--   1. Renames all 'visual-search' type values to 'auto-count'
--   2. Updates type constraint/enum to use 'auto-count'
--   3. Adds searchScope column for scope selection (current-page, entire-document, entire-project)

DO $$
DECLARE
    constraint_name TEXT;
    enum_type_name TEXT;
    enum_value_exists BOOLEAN;
BEGIN
    -- Step 1: Update all existing visual-search conditions to auto-count
    UPDATE takeoff_conditions 
    SET type = 'auto-count' 
    WHERE type = 'visual-search';
    
    RAISE NOTICE 'Updated % conditions from visual-search to auto-count', (SELECT COUNT(*) FROM takeoff_conditions WHERE type = 'auto-count');

    -- Step 2: Check if type column uses an ENUM type
    SELECT udt_name INTO enum_type_name
    FROM information_schema.columns
    WHERE table_name = 'takeoff_conditions'
      AND column_name = 'type'
      AND udt_name != 'text' AND udt_name != 'varchar' AND udt_name != 'character varying';
    
    -- If it's an enum type, update it
    IF enum_type_name IS NOT NULL AND enum_type_name != 'text' THEN
        -- Check if 'auto-count' already exists in the enum
        SELECT EXISTS (
            SELECT 1 
            FROM pg_enum 
            WHERE enumlabel = 'auto-count' 
              AND enumtypid = (SELECT oid FROM pg_type WHERE typname = enum_type_name)
        ) INTO enum_value_exists;
        
        IF NOT enum_value_exists THEN
            -- Add auto-count to enum
            EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS ''auto-count''', enum_type_name);
            RAISE NOTICE 'Added auto-count to enum type %', enum_type_name;
        ELSE
            RAISE NOTICE 'auto-count already exists in enum type %', enum_type_name;
        END IF;
        
        -- Note: We can't remove 'visual-search' from enum without recreating it, but that's okay
        -- The application code will only use 'auto-count' going forward
    ELSE
        -- Not an enum, check for CHECK constraint on type column
        SELECT c.conname INTO constraint_name
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid
        WHERE c.conrelid = 'takeoff_conditions'::regclass
          AND c.contype = 'c'
          AND a.attname = 'type'
          AND a.attrelid = 'takeoff_conditions'::regclass
        LIMIT 1;
        
        -- If no constraint found by column name, try finding by name pattern
        IF constraint_name IS NULL THEN
            SELECT conname INTO constraint_name
            FROM pg_constraint
            WHERE conrelid = 'takeoff_conditions'::regclass
              AND contype = 'c'
              AND conname LIKE '%type%'
            LIMIT 1;
        END IF;
        
        -- If we found a constraint, update it
        IF constraint_name IS NOT NULL THEN
            -- Drop the existing constraint
            EXECUTE format('ALTER TABLE takeoff_conditions DROP CONSTRAINT IF EXISTS %I', constraint_name);
            
            -- Add new constraint with 'auto-count' instead of 'visual-search'
            ALTER TABLE takeoff_conditions 
            ADD CONSTRAINT takeoff_conditions_type_check 
            CHECK (type IN ('area', 'volume', 'linear', 'count', 'auto-count'));
            
            RAISE NOTICE 'Updated CHECK constraint % to use auto-count', constraint_name;
        ELSE
            RAISE NOTICE 'No type constraint or enum found - type column may be unconstrained';
        END IF;
    END IF;

    -- Step 3: Add searchScope column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'takeoff_conditions' AND column_name = 'search_scope'
    ) THEN
        ALTER TABLE takeoff_conditions ADD COLUMN search_scope TEXT;
        COMMENT ON COLUMN takeoff_conditions.search_scope IS 'Search scope for auto-count conditions: current-page, entire-document, or entire-project';
        
        -- Set default scope for existing auto-count conditions
        UPDATE takeoff_conditions 
        SET search_scope = 'current-page' 
        WHERE type = 'auto-count' AND search_scope IS NULL;
        
        RAISE NOTICE 'Added search_scope column and set defaults for existing auto-count conditions';
    ELSE
        RAISE NOTICE 'search_scope column already exists';
    END IF;
END $$;
