import { supabase } from '../lib/supabase';

export interface OCRTrainingData {
  id?: string;
  projectId: string;
  documentId: string;
  pageNumber: number;
  fieldType: 'sheet_number' | 'sheet_name';
  originalText: string;
  correctedText: string;
  confidence: number;
  corrections: Array<{
    type: 'sheet_number' | 'sheet_name' | 'formatting';
    original: string;
    corrected: string;
    reason: string;
  }>;
  userValidated: boolean;
  fieldCoordinates?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  createdAt?: string;
}

export interface TrainingPattern {
  pattern: string;
  corrections: Array<{
    from: string;
    to: string;
    frequency: number;
  }>;
  confidence: number;
}

class OCRTrainingService {
  private trainingData: OCRTrainingData[] = [];
  private patterns: Map<string, TrainingPattern> = new Map();

  /**
   * Test database connection and table existence
   */
  async testDatabaseConnection(): Promise<boolean> {
    try {
      console.log('🔍 Testing database connection...');
      
      // Try to query the table to see if it exists
      const { data, error } = await supabase
        .from('ocr_training_data')
        .select('count')
        .limit(1);

      if (error) {
        console.error('❌ Database table does not exist or connection failed:', error);
        console.log('💡 You need to run the SQL migration script to create the table');
        return false;
      }

      console.log('✅ Database connection successful, table exists');
      return true;
    } catch (error) {
      console.error('❌ Database connection test failed:', error);
      return false;
    }
  }

  /**
   * Save training data for future pattern learning
   */
  async saveTrainingData(data: OCRTrainingData): Promise<void> {
    try {
      console.log('💾 Saving training data:', data);
      
      // Save to local storage first for immediate use
      this.trainingData.push(data);
      this.updateLocalPatterns(data);

      // Save to database for persistence
      const insertData = {
        project_id: data.projectId,
        document_id: data.documentId,
        page_number: data.pageNumber,
        field_type: data.fieldType,
        original_text: data.originalText,
        corrected_text: data.correctedText,
        confidence: data.confidence,
        corrections: data.corrections,
        user_validated: data.userValidated,
        field_coordinates: data.fieldCoordinates
      };
      
      console.log('💾 Inserting to database:', insertData);
      
      const { error } = await supabase
        .from('ocr_training_data')
        .insert(insertData);

      if (error) {
        console.error('❌ Failed to save training data:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
      } else {
        console.log('✅ Training data saved successfully to database');
      }
    } catch (error) {
      console.error('Error saving training data:', error);
    }
  }

  /**
   * Load training data from database via backend API
   */
  async loadTrainingData(projectId?: string): Promise<void> {
    try {
      console.log('🔍 Loading training data for projectId:', projectId);
      
      const url = projectId 
        ? `http://localhost:4000/api/ocr/training-data?projectId=${projectId}`
        : 'http://localhost:4000/api/ocr/training-data';

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      const data = result.trainingData || [];

      console.log('📊 Raw data from API:', data);
      console.log('📊 Number of rows returned:', data.length);
      
      this.trainingData = data.map((row: any) => ({
        id: row.id,
        projectId: row.project_id,
        documentId: row.document_id,
        pageNumber: row.page_number,
        fieldType: row.field_type,
        originalText: row.original_text,
        correctedText: row.corrected_text,
        confidence: row.confidence,
        corrections: row.corrections || [],
        userValidated: row.user_validated,
        fieldCoordinates: row.field_coordinates,
        createdAt: row.created_at
      }));

      // Rebuild patterns from loaded data
      this.rebuildPatterns();
      console.log(`✅ Loaded ${this.trainingData.length} training data entries`);
      console.log('📊 Training data entries:', this.trainingData);
    } catch (error) {
      console.error('Error loading training data:', error);
    }
  }

  /**
   * Update local patterns based on new training data
   */
  private updateLocalPatterns(data: OCRTrainingData): void {
    const patternKey = `${data.fieldType}_${data.originalText}`;
    
    if (!this.patterns.has(patternKey)) {
      this.patterns.set(patternKey, {
        pattern: data.originalText,
        corrections: [],
        confidence: 0
      });
    }

    const pattern = this.patterns.get(patternKey)!;
    
    // Add or update correction
    const existingCorrection = pattern.corrections.find(c => c.to === data.correctedText);
    if (existingCorrection) {
      existingCorrection.frequency++;
    } else {
      pattern.corrections.push({
        from: data.originalText,
        to: data.correctedText,
        frequency: 1
      });
    }

    // Update confidence based on frequency
    const totalCorrections = pattern.corrections.reduce((sum, c) => sum + c.frequency, 0);
    pattern.confidence = Math.min(100, (totalCorrections * 10));
  }

  /**
   * Rebuild patterns from all training data
   */
  private rebuildPatterns(): void {
    this.patterns.clear();
    
    this.trainingData.forEach(data => {
      this.updateLocalPatterns(data);
    });
  }

  /**
   * Get suggested correction based on training data
   */
  getSuggestedCorrection(fieldType: 'sheet_number' | 'sheet_name', originalText: string): string | null {
    const patternKey = `${fieldType}_${originalText}`;
    const pattern = this.patterns.get(patternKey);
    
    if (!pattern || pattern.corrections.length === 0) {
      return null;
    }

    // Return the most frequent correction
    const mostFrequent = pattern.corrections.reduce((prev, current) => 
      prev.frequency > current.frequency ? prev : current
    );

    return mostFrequent.to;
  }

  /**
   * Get confidence score based on training data
   */
  getConfidenceScore(fieldType: 'sheet_number' | 'sheet_name', originalText: string): number {
    const patternKey = `${fieldType}_${originalText}`;
    const pattern = this.patterns.get(patternKey);
    
    return pattern ? pattern.confidence : 0;
  }

  /**
   * Validate user correction and save as training data
   */
  async validateCorrection(
    projectId: string,
    documentId: string,
    pageNumber: number,
    fieldType: 'sheet_number' | 'sheet_name',
    originalText: string,
    userCorrectedText: string,
    ocrConfidence: number
  ): Promise<void> {
    try {
      console.log('💾 Validating correction:', { projectId, documentId, pageNumber, fieldType, originalText, userCorrectedText });
      
      // First, try to find existing entry using the backend API
      const response = await fetch(`http://localhost:4000/api/ocr/training-data?projectId=${projectId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch training data: ${response.status}`);
      }
      
      const result = await response.json();
      const trainingData = result.trainingData || [];
      
      // Find existing entry
      const existingEntry = trainingData.find((entry: any) => 
        entry.project_id === projectId &&
        entry.document_id === documentId &&
        entry.page_number === pageNumber &&
        entry.field_type === fieldType &&
        entry.original_text === originalText
      );

      if (existingEntry) {
        // Update existing entry using backend API
        console.log('📝 Updating existing entry:', existingEntry.id);
        
        const updateResponse = await fetch(`http://localhost:4000/api/ocr/training-data/${existingEntry.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            correctedText: userCorrectedText,
            userValidated: true,
            corrections: [{
              type: fieldType,
              original: originalText,
              corrected: userCorrectedText,
              reason: 'User validated correction'
            }]
          })
        });

        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          throw new Error(`Failed to update training data: ${updateResponse.status} - ${errorText}`);
        }
        
        console.log('✅ Successfully updated existing training data entry');
      } else {
        // Create new entry if none exists
        console.log('📝 Creating new training data entry');
        const trainingData: OCRTrainingData = {
          projectId,
          documentId,
          pageNumber,
          fieldType,
          originalText,
          correctedText: userCorrectedText,
          confidence: ocrConfidence,
          corrections: [{
            type: fieldType,
            original: originalText,
            corrected: userCorrectedText,
            reason: 'User validated correction'
          }],
          userValidated: true
        };

        await this.saveTrainingData(trainingData);
      }
    } catch (error) {
      console.error('❌ Error validating correction:', error);
      throw error;
    }
  }

  /**
   * Get all training data
   */
  getTrainingData(): OCRTrainingData[] {
    return [...this.trainingData];
  }

  /**
   * Get training statistics from backend API
   */
  async getTrainingStats(projectId?: string): Promise<{
    totalEntries: number;
    fieldTypeStats: Record<string, number>;
    confidenceStats: {
      average: number;
      high: number; // > 80%
      medium: number; // 50-80%
      low: number; // < 50%
    };
    recentActivity: number; // entries in last 7 days
  }> {
    try {
      const url = projectId 
        ? `http://localhost:4000/api/ocr/training-stats?projectId=${projectId}`
        : 'http://localhost:4000/api/ocr/training-stats';

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const stats = await response.json();
      return stats;
    } catch (error) {
      console.error('Error fetching training stats:', error);
      // Return empty stats on error
      return {
        totalEntries: 0,
        fieldTypeStats: {},
        confidenceStats: {
          average: 0,
          high: 0,
          medium: 0,
          low: 0
        },
        recentActivity: 0
      };
    }
  }

  /**
   * Export training data for analysis
   */
  exportTrainingData(): string {
    return JSON.stringify({
      trainingData: this.trainingData,
      patterns: Array.from(this.patterns.entries()),
      stats: this.getTrainingStats(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Clear all training data (for testing/reset)
   */
  async clearTrainingData(): Promise<void> {
    try {
      const { error } = await supabase
        .from('ocr_training_data')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

      if (error) {
        console.error('Failed to clear training data:', error);
      } else {
        this.trainingData = [];
        this.patterns.clear();
        console.log('✅ Training data cleared');
      }
    } catch (error) {
      console.error('Error clearing training data:', error);
    }
  }
}

export const ocrTrainingService = new OCRTrainingService();
