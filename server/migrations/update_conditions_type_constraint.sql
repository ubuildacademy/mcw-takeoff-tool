-- Migration: Update type CHECK constraint or ENUM to include 'visual-search'
-- Date: 2025-01-XX
-- Description: Updates the type constraint/enum to allow 'visual-search' as a valid value
-- This migration handles both CHECK constraints and ENUM types

DO $$
DECLARE
    constraint_name TEXT;
    enum_type_name TEXT;
    enum_value_exists BOOLEAN;
BEGIN
    -- First, check if type column uses an ENUM type
    SELECT udt_name INTO enum_type_name
    FROM information_schema.columns
    WHERE table_name = 'takeoff_conditions'
      AND column_name = 'type'
      AND udt_name != 'text' AND udt_name != 'varchar' AND udt_name != 'character varying';
    
    -- If it's an enum type, add 'visual-search' to it
    IF enum_type_name IS NOT NULL AND enum_type_name != 'text' THEN
        -- Check if 'visual-search' already exists in the enum
        SELECT EXISTS (
            SELECT 1 
            FROM pg_enum 
            WHERE enumlabel = 'visual-search' 
              AND enumtypid = (SELECT oid FROM pg_type WHERE typname = enum_type_name)
        ) INTO enum_value_exists;
        
        IF NOT enum_value_exists THEN
            EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS ''visual-search''', enum_type_name);
            RAISE NOTICE 'Added visual-search to enum type %', enum_type_name;
        ELSE
            RAISE NOTICE 'visual-search already exists in enum type %', enum_type_name;
        END IF;
    ELSE
        -- Not an enum, check for CHECK constraint on type column
        -- Find constraints that check the type column
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
            
            -- Add new constraint with 'visual-search' included
            ALTER TABLE takeoff_conditions 
            ADD CONSTRAINT takeoff_conditions_type_check 
            CHECK (type IN ('area', 'volume', 'linear', 'count', 'visual-search'));
            
            RAISE NOTICE 'Updated CHECK constraint % to include visual-search', constraint_name;
        ELSE
            -- No constraint found - column might be unconstrained
            RAISE NOTICE 'No type constraint or enum found - type column may be unconstrained';
        END IF;
    END IF;
END $$;
