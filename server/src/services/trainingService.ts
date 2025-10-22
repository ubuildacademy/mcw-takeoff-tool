/**
 * Training Service for AI Takeoff Agent
 * 
 * This service handles training the AI agent by collecting human examples
 * and using them to improve the agent's performance
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export interface TrainingExample {
  id?: string;
  projectId: string;
  documentId: string;
  pageNumber: number;
  scope: string;
  humanActions: HumanAction[];
  aiResult?: AITakeoffResult;
  accuracy: number;
  feedback: string;
  createdAt?: string;
}

export interface HumanAction {
  type: 'click' | 'drag' | 'select' | 'measure';
  coordinates: { x: number; y: number }[];
  conditionName: string;
  measurementType: 'area' | 'linear' | 'count' | 'volume';
  value: number;
  unit: string;
  timestamp: number;
}

export interface AITakeoffResult {
  conditions: Array<{
    name: string;
    type: string;
    unit: string;
    description: string;
    color: string;
  }>;
  measurements: Array<{
    conditionIndex: number;
    points: Array<{ x: number; y: number }>;
    calculatedValue: number;
  }>;
  calibration: {
    scaleFactor: number;
    unit: string;
    scaleText: string;
  };
}

export class TrainingService {
  private supabase: any;

  constructor() {
    this.supabase = supabase;
  }

  /**
   * Start a training session for a specific scope
   */
  async startTrainingSession(
    projectId: string,
    documentId: string,
    pageNumber: number,
    scope: string
  ): Promise<string> {
    try {
      console.log(`🎓 Starting training session for scope: ${scope}`);
      
      const { data, error } = await this.supabase
        .from('training_sessions')
        .insert({
          project_id: projectId,
          document_id: documentId,
          page_number: pageNumber,
          scope: scope,
          status: 'active',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create training session: ${error.message}`);
      }

      console.log(`✅ Training session started: ${data.id}`);
      return data.id;
    } catch (error) {
      console.error('❌ Failed to start training session:', error);
      throw error;
    }
  }

  /**
   * Record a human action during training
   */
  async recordHumanAction(
    sessionId: string,
    action: HumanAction
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('training_actions')
        .insert({
          session_id: sessionId,
          action_type: action.type,
          coordinates: action.coordinates,
          condition_name: action.conditionName,
          measurement_type: action.measurementType,
          value: action.value,
          unit: action.unit,
          timestamp: action.timestamp
        });

      if (error) {
        throw new Error(`Failed to record action: ${error.message}`);
      }

      console.log(`📝 Recorded ${action.type} action for ${action.conditionName}`);
    } catch (error) {
      console.error('❌ Failed to record human action:', error);
      throw error;
    }
  }

  /**
   * Complete a training session with AI comparison
   */
  async completeTrainingSession(
    sessionId: string,
    aiResult: AITakeoffResult,
    accuracy: number,
    feedback: string
  ): Promise<void> {
    try {
      console.log(`🏁 Completing training session: ${sessionId}`);
      
      const { error } = await this.supabase
        .from('training_sessions')
        .update({
          status: 'completed',
          ai_result: aiResult,
          accuracy: accuracy,
          feedback: feedback,
          completed_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      if (error) {
        throw new Error(`Failed to complete training session: ${error.message}`);
      }

      console.log(`✅ Training session completed with accuracy: ${accuracy}%`);
    } catch (error) {
      console.error('❌ Failed to complete training session:', error);
      throw error;
    }
  }

  /**
   * Get training examples for a specific scope
   */
  async getTrainingExamples(scope: string, limit: number = 10): Promise<TrainingExample[]> {
    try {
      const { data, error } = await this.supabase
        .from('training_sessions')
        .select(`
          *,
          training_actions (*)
        `)
        .eq('scope', scope)
        .eq('status', 'completed')
        .order('accuracy', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get training examples: ${error.message}`);
      }

      return data.map(session => ({
        id: session.id,
        projectId: session.project_id,
        documentId: session.document_id,
        pageNumber: session.page_number,
        scope: session.scope,
        humanActions: session.training_actions || [],
        aiResult: session.ai_result,
        accuracy: session.accuracy,
        feedback: session.feedback,
        createdAt: session.created_at
      }));
    } catch (error) {
      console.error('❌ Failed to get training examples:', error);
      throw error;
    }
  }

  /**
   * Analyze training data to improve AI prompts
   */
  async analyzeTrainingData(scope: string): Promise<{
    commonPatterns: string[];
    accuracyTrends: number[];
    improvementSuggestions: string[];
  }> {
    try {
      console.log(`📊 Analyzing training data for scope: ${scope}`);
      
      const examples = await this.getTrainingExamples(scope, 50);
      
      if (examples.length === 0) {
        return {
          commonPatterns: [],
          accuracyTrends: [],
          improvementSuggestions: ['Need more training data for this scope']
        };
      }

      // Analyze common patterns in human actions
      const commonPatterns = this.extractCommonPatterns(examples);
      
      // Analyze accuracy trends
      const accuracyTrends = examples.map(ex => ex.accuracy);
      
      // Generate improvement suggestions
      const improvementSuggestions = this.generateImprovementSuggestions(examples);

      return {
        commonPatterns,
        accuracyTrends,
        improvementSuggestions
      };
    } catch (error) {
      console.error('❌ Failed to analyze training data:', error);
      throw error;
    }
  }

  /**
   * Extract common patterns from training examples
   */
  private extractCommonPatterns(examples: TrainingExample[]): string[] {
    const patterns: string[] = [];
    
    // Analyze condition naming patterns
    const conditionNames = examples.flatMap(ex => 
      ex.humanActions.map(action => action.conditionName)
    );
    
    const namePatterns = this.findCommonPatterns(conditionNames);
    patterns.push(...namePatterns.map(pattern => `Condition naming: ${pattern}`));
    
    // Analyze measurement patterns
    const measurementTypes = examples.flatMap(ex => 
      ex.humanActions.map(action => action.measurementType)
    );
    
    const measurementPatterns = this.findCommonPatterns(measurementTypes);
    patterns.push(...measurementPatterns.map(pattern => `Measurement type: ${pattern}`));
    
    return patterns;
  }

  /**
   * Find common patterns in a list of strings
   */
  private findCommonPatterns(items: string[]): string[] {
    const frequency: { [key: string]: number } = {};
    
    items.forEach(item => {
      frequency[item] = (frequency[item] || 0) + 1;
    });
    
    return Object.entries(frequency)
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pattern, _]) => pattern);
  }

  /**
   * Generate improvement suggestions based on training data
   */
  private generateImprovementSuggestions(examples: TrainingExample[]): string[] {
    const suggestions: string[] = [];
    
    // Analyze accuracy
    const avgAccuracy = examples.reduce((sum, ex) => sum + ex.accuracy, 0) / examples.length;
    
    if (avgAccuracy < 70) {
      suggestions.push('Low accuracy detected - consider more training examples');
    }
    
    // Analyze feedback patterns
    const feedbackWords = examples.flatMap(ex => 
      ex.feedback.toLowerCase().split(' ')
    );
    
    const commonIssues = this.findCommonPatterns(feedbackWords);
    commonIssues.forEach(issue => {
      if (issue.length > 3) {
        suggestions.push(`Common issue: ${issue}`);
      }
    });
    
    return suggestions;
  }

  /**
   * Create training prompts based on collected data
   */
  async generateTrainingPrompts(scope: string): Promise<string> {
    try {
      const analysis = await this.analyzeTrainingData(scope);
      
      let prompt = `You are a construction takeoff expert. Based on training data analysis:\n\n`;
      
      if (analysis.commonPatterns.length > 0) {
        prompt += `Common patterns observed:\n`;
        analysis.commonPatterns.forEach(pattern => {
          prompt += `- ${pattern}\n`;
        });
        prompt += `\n`;
      }
      
      if (analysis.improvementSuggestions.length > 0) {
        prompt += `Improvement suggestions:\n`;
        analysis.improvementSuggestions.forEach(suggestion => {
          prompt += `- ${suggestion}\n`;
        });
        prompt += `\n`;
      }
      
      prompt += `Use this training data to improve your analysis accuracy for: ${scope}`;
      
      return prompt;
    } catch (error) {
      console.error('❌ Failed to generate training prompts:', error);
      throw error;
    }
  }
}

export const trainingService = new TrainingService();
