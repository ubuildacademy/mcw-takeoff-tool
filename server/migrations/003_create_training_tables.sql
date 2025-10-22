-- Training tables for AI Takeoff Agent
-- This migration creates tables to store training data for the AI agent

-- Training sessions table
CREATE TABLE IF NOT EXISTS training_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    scope TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed')),
    ai_result JSONB,
    accuracy DECIMAL(5,2),
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Training actions table (human actions during training)
CREATE TABLE IF NOT EXISTS training_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL CHECK (action_type IN ('click', 'drag', 'select', 'measure')),
    coordinates JSONB NOT NULL, -- Array of {x, y} coordinates
    condition_name TEXT NOT NULL,
    measurement_type TEXT NOT NULL CHECK (measurement_type IN ('area', 'linear', 'count', 'volume')),
    value DECIMAL(10,2),
    unit TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Training examples table (completed training sessions with examples)
CREATE TABLE IF NOT EXISTS training_examples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    human_actions JSONB NOT NULL, -- Array of human actions
    ai_result JSONB NOT NULL, -- AI result for comparison
    accuracy DECIMAL(5,2) NOT NULL,
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Training analytics table (aggregated training data)
CREATE TABLE IF NOT EXISTS training_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope TEXT NOT NULL,
    total_sessions INTEGER DEFAULT 0,
    avg_accuracy DECIMAL(5,2) DEFAULT 0,
    common_patterns JSONB,
    improvement_suggestions JSONB,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_training_sessions_scope ON training_sessions(scope);
CREATE INDEX IF NOT EXISTS idx_training_sessions_status ON training_sessions(status);
CREATE INDEX IF NOT EXISTS idx_training_sessions_accuracy ON training_sessions(accuracy);
CREATE INDEX IF NOT EXISTS idx_training_actions_session_id ON training_actions(session_id);
CREATE INDEX IF NOT EXISTS idx_training_examples_scope ON training_examples(scope);
CREATE INDEX IF NOT EXISTS idx_training_analytics_scope ON training_analytics(scope);

-- RLS policies for training tables
ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_analytics ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access training data for their own projects
CREATE POLICY "Users can access training data for their projects" ON training_sessions
    FOR ALL USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can access training actions for their projects" ON training_actions
    FOR ALL USING (
        session_id IN (
            SELECT id FROM training_sessions 
            WHERE project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can access training examples for their projects" ON training_examples
    FOR ALL USING (
        session_id IN (
            SELECT id FROM training_sessions 
            WHERE project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can access training analytics for their projects" ON training_analytics
    FOR ALL USING (true); -- Analytics are shared across users for learning
