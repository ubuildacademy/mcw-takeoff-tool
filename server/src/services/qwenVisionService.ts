import axios from 'axios';

interface QwenVisionRequest {
  model: string;
  prompt: string;
  images: string[]; // Base64 encoded images
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
  };
}

interface QwenVisionResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

interface AITakeoffAnalysis {
  conditions: Array<{
    name: string;
    type: 'area' | 'volume' | 'linear' | 'count';
    unit: string;
    description: string;
    color: string;
  }>;
  measurements: Array<{
    conditionIndex: number;
    points: Array<{ x: number; y: number }>;
    calculatedValue: number;
  }>;
  calibration?: {
    scaleFactor: number;
    unit: string;
    scaleText?: string;
  };
}

class QwenVisionService {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    // Use the same Ollama cloud API as chat AI
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.com';
    this.apiKey = process.env.OLLAMA_API_KEY || process.env.VITE_OLLAMA_API_KEY || '';
    this.model = process.env.QWEN_VISION_MODEL || 'qwen3-vl:235b'; // Use available model format
    
    // Check if we have API credentials
    if (!this.apiKey) {
      console.warn('⚠️ No Ollama API key configured. Qwen3-VL will not be available.');
    }
  }

  /**
   * Analyze a construction drawing page for takeoff items using Qwen3-VL
   */
  async analyzePageForTakeoff(
    imageData: string, 
    scope: string, 
    pageNumber: number,
    pageType?: string,
    ocrContext?: any
  ): Promise<AITakeoffAnalysis> {
    // Check if API key is available
    if (!this.apiKey) {
      console.log(`⚠️ No API key available for Qwen3-VL analysis of page ${pageNumber}`);
      console.log(`🔧 Returning fallback result for page ${pageNumber}`);
      
      // Return a fallback result instead of throwing an error
      return {
        conditions: [],
        measurements: [],
        calibration: {
          scaleFactor: 0.0833,
          unit: 'ft',
          scaleText: 'estimated'
        }
      };
    }
    
    try {
      const prompt = this.buildTakeoffPrompt(scope, pageNumber, pageType);
      
      const request = {
        model: this.model,
        messages: [
          {
            role: 'user',
            content: prompt,
            images: [imageData]
          }
        ],
        stream: false,
        options: {
          temperature: 0.3, // Lower temperature for more consistent results
          top_p: 0.9
        }
      };

      console.log(`🚀 Sending Qwen3-VL request for page ${pageNumber} with scope: ${scope}`);
      console.log(`📊 Request details: model=${this.model}, imageSize=${imageData.length} chars`);
      console.log(`📝 Prompt preview: ${prompt.substring(0, 200)}...`);
      
      // Save the image for debugging
      const debugImagePath = `/tmp/debug_page_${pageNumber}.jpg`;
      try {
        const imageBuffer = Buffer.from(imageData, 'base64');
        require('fs').writeFileSync(debugImagePath, imageBuffer);
        console.log(`🔍 Debug image saved to: ${debugImagePath}`);
      } catch (e) {
        console.log('⚠️ Could not save debug image');
      }
      
      const startTime = Date.now();
      // Retry logic for 503 errors with more aggressive backoff
      let response;
      let retryCount = 0;
      const maxRetries = 5; // Increased retries
      
      while (retryCount < maxRetries) {
        try {
          response = await axios.post(`${this.baseUrl}/api/chat`, request, {
            timeout: 600000, // 10 minutes timeout for complex analysis
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            }
          });
          break; // Success, exit retry loop
        } catch (error: any) {
          if (error.response?.status === 503 && retryCount < maxRetries - 1) {
            retryCount++;
            const delay = Math.min(5000 * Math.pow(2, retryCount), 60000); // Exponential backoff up to 60s
            console.log(`🔄 Retry ${retryCount}/${maxRetries} for 503 error on page ${pageNumber}, waiting ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw error; // Re-throw if not 503 or max retries reached
        }
      }
      
      const duration = Date.now() - startTime;
      console.log(`⏱️ Qwen3-VL request completed in ${duration}ms`);

      const aiResponse = response.data.message?.content || '';
      console.log(`Qwen3-VL response for page ${pageNumber}:`, aiResponse.substring(0, 500) + '...');
      
      // Log the full response for debugging
      console.log('Full Qwen3-VL response for page', pageNumber, ':', JSON.stringify(response.data, null, 2));
      console.log(`Full Qwen3-VL response for page ${pageNumber}:`, aiResponse);
      
      // Check if response is empty or invalid
      if (!aiResponse || aiResponse.trim().length === 0) {
        throw new Error('Empty response from Qwen3-VL');
      }

      let parsedResult;
      try {
        parsedResult = this.parseTakeoffResponse(aiResponse);
        console.log(`Parsed Qwen3-VL result for page ${pageNumber}:`, {
          conditionsCount: parsedResult.conditions.length,
          measurementsCount: parsedResult.measurements.length,
          hasCalibration: !!parsedResult.calibration,
          calibration: parsedResult.calibration
        });
      } catch (parseError) {
        console.error(`❌ Failed to parse Qwen3-VL response for page ${pageNumber}:`, parseError);
        console.log(`🔧 Creating fallback result for page ${pageNumber}`);
        
        // Create a fallback result with basic structure
        parsedResult = {
          conditions: [],
          measurements: [],
          calibration: {
            scaleFactor: 1,
            unit: 'feet'
          }
        };
      }

      return parsedResult;
    } catch (error) {
      console.error(`❌ Error analyzing page ${pageNumber} with Qwen3-VL:`, error);
      console.log(`🔧 Returning fallback result for page ${pageNumber} due to error`);
      
      // Return a fallback result instead of throwing an error
      return {
        conditions: [],
        measurements: [],
        calibration: {
          scaleFactor: 0.0833,
          unit: 'ft',
          scaleText: 'estimated'
        }
      };
    }
  }

  /**
   * Build the system prompt for takeoff analysis
   */
  private buildTakeoffPrompt(scope: string, pageNumber: number, pageType?: string): string {
    // Specialized prompt for floor plan analysis
    if (this.isFlooringScope(scope) && pageType === 'floor-plan') {
      return this.buildFloorPlanPrompt(scope, pageNumber);
    }
    
    // Specialized prompt for finish schedule analysis
    if (this.isFlooringScope(scope) && pageType === 'finish-schedule') {
      return this.buildFinishSchedulePrompt(scope, pageNumber);
    }

    // Default prompt for other types - optimized for construction takeoffs
    return this.buildAdaptivePrompt(scope, pageNumber);
  }

  /**
   * Build adaptive prompt based on scope type - STRUCTURED VERSION
   */
  private buildAdaptivePrompt(scope: string, pageNumber: number, ocrContext?: any): string {
    const scopeLower = scope.toLowerCase();
    
    // Determine measurement type and strategy based on scope
    const measurementConfig = this.determineMeasurementType(scopeLower);
    
    return `You are a construction takeoff expert. Analyze this architectural drawing to find and measure: "${scope}"

ANALYSIS REQUIREMENTS:
1. Identify ALL items matching the scope
2. Provide EXACT pixel coordinates for each item
3. Calculate precise measurements using drawing scale
4. Return structured JSON only

${ocrContext ? `OCR CONTEXT INFORMATION:
- Scale Information: ${ocrContext.scaleInfo ? JSON.stringify(ocrContext.scaleInfo) : 'Not detected'}
- Room Names: ${ocrContext.roomNames?.join(', ') || 'None detected'}
- Dimensions Found: ${ocrContext.dimensions?.map(d => d.text).join(', ') || 'None detected'}
- Symbols: ${ocrContext.symbols?.join(', ') || 'None detected'}
- Context: ${ocrContext.context || 'No additional context'}

Use this OCR information to improve your analysis accuracy and scale detection.
` : ''}

DETECTION STRATEGY:
1. **SCALE DETECTION**: Find scale bar, dimension lines, or text indicating scale (1/8"=1'-0", 1/4"=1'-0", etc.)
2. **ELEMENT IDENTIFICATION**: Look for specific patterns and symbols
3. **COORDINATE MAPPING**: Map each element to precise pixel coordinates
4. **MEASUREMENT CALCULATION**: Calculate actual dimensions using scale

COORDINATE SYSTEM:
- Use 0-1 coordinate system where (0,0)=top-left, (1,1)=bottom-right
- Provide coordinates as decimal values (e.g., 0.25, 0.75)
- For areas: minimum 3 points to form polygon
- For linear: 2+ points along the path
- For counts: single point at center

${measurementConfig.instructions}

SPECIFIC PATTERNS TO LOOK FOR:
${measurementConfig.patterns}

SCALE DETECTION PRIORITY:
1. Look for scale bars with measurements
2. Check dimension lines with actual measurements
3. Look for text like "Scale: 1/4" = 1'-0""
4. If no scale found, use estimated scale factor

OUTPUT FORMAT - Return ONLY this JSON structure:
{
  "conditions": [
    {
      "name": "${scope}",
      "type": "${measurementConfig.type}",
      "unit": "${measurementConfig.unit}",
      "description": "${measurementConfig.description}",
      "color": "#4CAF50"
    }
  ],
  "measurements": ${measurementConfig.exampleMeasurements},
  "calibration": {
    "scaleFactor": 0.0833,
    "unit": "ft",
    "scaleText": "1/8\\" = 1'-0\\""
  }
}

CRITICAL RULES:
1. Return ONLY valid JSON
2. Provide exact coordinates for each element
3. Calculate measurements using detected scale
4. Group similar elements together
5. If no items found, return empty arrays

RESPONSE FORMAT: Start with { and end with }. No other text.`;
  }

  /**
   * Determine measurement type and configuration based on scope - STRUCTURED VERSION
   */
  private determineMeasurementType(scopeLower: string): {
    type: 'count' | 'linear' | 'area' | 'volume';
    unit: string;
    description: string;
    instructions: string;
    patterns: string;
    exampleMeasurements: string;
  } {
    // Count measurements (individual items)
    if (this.isCountScope(scopeLower)) {
      return {
        type: 'count',
        unit: 'EA',
        description: `${scopeLower} items found on drawings`,
        instructions: `COUNT DETECTION STRATEGY:
1. Look for individual symbols, labels, or text containing "${scopeLower}"
2. Identify each discrete item that can be counted
3. Place a single point at the center of each item
4. Group identical items together for efficiency
5. Verify each item is actually present in the drawing`,
        patterns: `SYMBOL PATTERNS:
- Room labels, unit designations, or symbols containing "${scopeLower}"
- Individual fixtures, equipment, or components
- Text annotations or callouts
- Architectural symbols (doors, windows, outlets, etc.)
- Equipment symbols or labels

DETECTION PRIORITY:
1. Clear text labels and annotations
2. Standard architectural symbols
3. Equipment and fixture symbols
4. Any discrete countable items`,
        exampleMeasurements: `[
          {"conditionIndex": 0, "points": [{"x": 0.25, "y": 0.35}], "calculatedValue": 1.0},
          {"conditionIndex": 0, "points": [{"x": 0.45, "y": 0.35}], "calculatedValue": 1.0}
        ]`
      };
    }
    
    // Linear measurements (lengths, perimeters)
    if (this.isLinearScope(scopeLower)) {
      return {
        type: 'linear',
        unit: 'LF',
        description: `${scopeLower} linear measurements`,
        instructions: `LINEAR DETECTION STRATEGY:
1. Identify continuous linear elements (walls, edges, boundaries)
2. Place points along the length to define the measurement path
3. Follow the exact path of the linear element
4. Use multiple points for curved or complex paths
5. Calculate actual length using drawing scale`,
        patterns: `LINEAR ELEMENT PATTERNS:
- Walls (thick lines, double lines, wall symbols)
- Rooflines and roof edges
- Boundaries and property lines
- Trim, baseboards, and moldings
- Pipes, conduits, and linear utilities
- Edges of surfaces or materials

DETECTION PRIORITY:
1. Clear wall lines and boundaries
2. Rooflines and structural elements
3. Trim and finish elements
4. Utility lines and conduits`,
        exampleMeasurements: `[
          {"conditionIndex": 0, "points": [{"x": 0.2, "y": 0.3}, {"x": 0.8, "y": 0.3}], "calculatedValue": 60.0},
          {"conditionIndex": 0, "points": [{"x": 0.1, "y": 0.5}, {"x": 0.9, "y": 0.5}], "calculatedValue": 80.0}
        ]`
      };
    }
    
    // Area measurements (surfaces, rooms)
    if (this.isAreaScope(scopeLower)) {
      return {
        type: 'area',
        unit: 'SF',
        description: `${scopeLower} area measurements`,
        instructions: `AREA DETECTION STRATEGY:
1. Identify enclosed spaces, rooms, or surface areas
2. Place points to define the perimeter (minimum 3 points for polygon)
3. Follow the exact boundaries of the space
4. Include all corners and follow wall lines precisely
5. Calculate area using drawing scale and polygon math`,
        patterns: `AREA PATTERNS:
- Rooms and enclosed spaces (bedrooms, living rooms, kitchens)
- Floor areas with specific materials or finishes
- Ceiling areas and wall surfaces
- Outdoor spaces (patios, decks, driveways)
- Material coverage areas (paint, flooring, roofing)

DETECTION PRIORITY:
1. Clear room boundaries and wall lines
2. Floor plan areas with specific materials
3. Ceiling and wall surface areas
4. Outdoor and exterior spaces`,
        exampleMeasurements: `[
          {"conditionIndex": 0, "points": [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.2}, {"x": 0.8, "y": 0.8}, {"x": 0.2, "y": 0.8}], "calculatedValue": 360.0},
          {"conditionIndex": 0, "points": [{"x": 0.1, "y": 0.1}, {"x": 0.6, "y": 0.1}, {"x": 0.6, "y": 0.6}, {"x": 0.1, "y": 0.6}], "calculatedValue": 250.0}
        ]`
      };
    }
    
    // Volume measurements (3D spaces)
    if (this.isVolumeScope(scopeLower)) {
      return {
        type: 'volume',
        unit: 'CF',
        description: `${scopeLower} volume measurements`,
        instructions: `VOLUME DETECTION STRATEGY:
1. Identify 3D spaces or areas with defined heights/depths
2. Place points to define the base area (minimum 3 points for polygon)
3. Look for height information in dimensions or notes
4. Calculate volume using base area × height/depth
5. Group similar volumes together for efficiency`,
        patterns: `VOLUME PATTERNS:
- 3D spaces with defined heights (rooms, basements)
- Excavation areas with depth specifications
- Concrete volumes (footings, slabs, walls)
- Material volumes (backfill, gravel, soil)
- Storage or utility spaces

DETECTION PRIORITY:
1. Clear height/depth dimensions on drawings
2. Excavation and earthwork areas
3. Concrete and structural volumes
4. Material storage and utility spaces`,
        exampleMeasurements: `[
          {"conditionIndex": 0, "points": [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.2}, {"x": 0.8, "y": 0.8}, {"x": 0.2, "y": 0.8}], "calculatedValue": 1800.0},
          {"conditionIndex": 0, "points": [{"x": 0.1, "y": 0.1}, {"x": 0.6, "y": 0.1}, {"x": 0.6, "y": 0.6}, {"x": 0.1, "y": 0.6}], "calculatedValue": 1250.0}
        ]`
      };
    }
    
    // Default to count if no specific type detected
    return {
      type: 'count',
      unit: 'EA',
      description: `${scopeLower} items found on drawings`,
      instructions: `GENERAL DETECTION STRATEGY:
1. Look for any text, labels, or symbols related to "${scopeLower}"
2. Identify individual items that can be counted
3. Place a single point at the center of each item
4. Group similar items together for efficiency
5. Verify each item is actually present in the drawing`,
      patterns: `GENERAL PATTERNS:
- Any text, labels, or symbols related to "${scopeLower}"
- Individual items that can be identified and counted
- Architectural symbols and annotations
- Equipment and fixture symbols
- Any discrete countable elements

DETECTION PRIORITY:
1. Clear text labels and annotations
2. Standard architectural symbols
3. Equipment and fixture symbols
4. Any discrete countable items`,
      exampleMeasurements: `[
        {"conditionIndex": 0, "points": [{"x": 0.25, "y": 0.35}], "calculatedValue": 1.0},
        {"conditionIndex": 0, "points": [{"x": 0.45, "y": 0.35}], "calculatedValue": 1.0}
      ]`
    };
  }

  /**
   * Check if scope is related to counting individual items
   */
  private isCountScope(scopeLower: string): boolean {
    const countKeywords = ['units', 'fixtures', 'doors', 'windows', 'outlets', 'switches', 'lights', 'furniture', 'equipment', 'count', 'each', 'ea'];
    return countKeywords.some(keyword => scopeLower.includes(keyword));
  }

  /**
   * Check if scope is related to linear measurements
   */
  private isLinearScope(scopeLower: string): boolean {
    const linearKeywords = ['walls', 'roofline', 'roof line', 'perimeter', 'edge', 'linear', 'length', 'lf', 'linear feet', 'roof', 'gutter', 'trim', 'baseboard'];
    return linearKeywords.some(keyword => scopeLower.includes(keyword));
  }

  /**
   * Check if scope is related to area measurements
   */
  private isAreaScope(scopeLower: string): boolean {
    const areaKeywords = ['floor', 'ceiling', 'wall surface', 'area', 'sf', 'square feet', 'room', 'space', 'surface', 'paint', 'carpet', 'tile', 'flooring'];
    return areaKeywords.some(keyword => scopeLower.includes(keyword));
  }

  /**
   * Check if scope is related to volume measurements
   */
  private isVolumeScope(scopeLower: string): boolean {
    const volumeKeywords = ['volume', 'cf', 'cubic feet', 'excavation', 'concrete', 'backfill', 'material', '3d', 'cubic'];
    return volumeKeywords.some(keyword => scopeLower.includes(keyword));
  }

  /**
   * Check if scope is related to flooring
   */
  private isFlooringScope(scope: string): boolean {
    const flooringKeywords = ['lvt', 'luxury vinyl tile', 'carpet', 'tile', 'flooring', 'floor', 'vinyl', 'laminate', 'hardwood', 'ceramic', 'porcelain'];
    const scopeLower = scope.toLowerCase();
    return flooringKeywords.some(keyword => scopeLower.includes(keyword));
  }

  /**
   * Build specialized prompt for floor plan analysis
   */
  private buildFloorPlanPrompt(scope: string, pageNumber: number): string {
    return `You are a construction takeoff expert specializing in flooring analysis of architectural floor plans.

SCOPE: ${scope}

This is a FLOOR PLAN (Page ${pageNumber}). Your task is to identify areas where the specified flooring type is installed.

CRITICAL FLOOR PLAN ANALYSIS STEPS:

1. **SCALE DETECTION**: First, find the scale bar or dimension lines. Common scales: 1/8"=1'-0", 1/4"=1'-0", 1/2"=1'-0". Calculate pixels per foot.

2. **ROOM IDENTIFICATION**: Look for:
   - Room labels, numbers, or names (e.g., "LIVING ROOM", "BEDROOM 1", "KITCHEN")
   - Wall boundaries (thick lines, double lines)
   - Room perimeters and shapes
   - Door openings and windows

3. **FLOORING INDICATORS**: Look for:
   - Flooring patterns, hatching, or symbols
   - Different line types or colors indicating flooring types
   - Finish specifications or notes
   - Room schedules or legends

4. **MEASUREMENT PLACEMENT**: For each room/area:
   - Create polygon points that follow the EXACT room boundaries
   - Include all corners and follow wall lines precisely
   - Don't include closets, built-ins, or non-flooring areas unless specified
   - Group similar rooms together (e.g., "Bedroom 1", "Bedroom 2" → "Bedrooms")

5. **ACCURATE CALCULATIONS**: 
   - Measure room dimensions using the scale
   - Calculate square footage for each room
   - Be precise with measurements - they will be used for cost estimation

COORDINATE PRECISION:
- Use exact coordinates that follow room boundaries
- For rectangular rooms: 4 corner points
- For complex rooms: multiple points following the perimeter
- Ensure points form a closed polygon

EXAMPLE ANALYSIS:
- Living Room: 15' x 20' = 300 SF
- Bedroom 1: 12' x 14' = 168 SF  
- Bedroom 2: 12' x 14' = 168 SF
- Group bedrooms: 168 + 168 = 336 SF

Return ONLY valid JSON in this exact format:
{
  "conditions": [
    {
      "name": "LVT Flooring - Living Room",
      "type": "area",
      "unit": "SF",
      "description": "Luxury vinyl tile flooring in living room area",
      "color": "#4CAF50"
    },
    {
      "name": "LVT Flooring - Bedrooms",
      "type": "area", 
      "unit": "SF",
      "description": "Luxury vinyl tile flooring in bedroom areas",
      "color": "#2196F3"
    }
  ],
  "measurements": [
    {
      "conditionIndex": 0,
      "points": [
        {"x": 0.1, "y": 0.2}, {"x": 0.4, "y": 0.2}, 
        {"x": 0.4, "y": 0.6}, {"x": 0.1, "y": 0.6}
      ],
      "calculatedValue": 300.0
    },
    {
      "conditionIndex": 1,
      "points": [
        {"x": 0.5, "y": 0.1}, {"x": 0.8, "y": 0.1},
        {"x": 0.8, "y": 0.5}, {"x": 0.5, "y": 0.5}
      ],
      "calculatedValue": 336.0
    }
  ],
  "calibration": {
    "scaleFactor": 0.0833,
    "unit": "ft",
    "scaleText": "1/8\" = 1'-0\""
  }
}

If you cannot find any areas with the specified flooring, return:
{
  "conditions": [],
  "measurements": [],
  "calibration": {
    "scaleFactor": 0.0833,
    "unit": "ft",
    "scaleText": "estimated"
  }
}`;
  }

  /**
   * Build specialized prompt for finish schedule analysis
   */
  private buildFinishSchedulePrompt(scope: string, pageNumber: number): string {
    return `You are a construction takeoff expert analyzing finish schedules for flooring specifications.

SCOPE: ${scope}

This is a FINISH SCHEDULE (Page ${pageNumber}). Your task is to extract flooring specifications and room assignments.

For finish schedule analysis, you need to:

1. **Find Flooring Specifications**: Look for tables, schedules, or lists that specify flooring materials
2. **Identify Room Assignments**: Match room numbers/names with their corresponding flooring types
3. **Extract Material Details**: Note specific flooring products, colors, or specifications
4. **Create Reference Conditions**: Create conditions that can be referenced when measuring floor plans

IMPORTANT FINISH SCHEDULE ANALYSIS:
- Look for tables with columns like "Room", "Flooring", "Material", "Finish"
- Identify room numbers or names and their corresponding flooring specifications
- Look for abbreviations like "LVT", "VCT", "Carpet", "Tile"
- Note any special requirements or notes about the flooring

Create conditions that represent the flooring specifications found in the schedule. These will be used as reference when measuring actual floor plan areas.

Return ONLY valid JSON in this exact format:
{
  "conditions": [
    {
      "name": "LVT Flooring - Living Areas",
      "type": "area",
      "unit": "SF", 
      "description": "Luxury vinyl tile as specified in finish schedule for living areas",
      "color": "#4CAF50"
    },
    {
      "name": "LVT Flooring - Bedrooms",
      "type": "area",
      "unit": "SF",
      "description": "Luxury vinyl tile as specified in finish schedule for bedrooms", 
      "color": "#2196F3"
    }
  ],
  "measurements": [],
  "calibration": null
}

Note: Finish schedules typically don't contain measurements - they contain specifications. The actual measurements will be taken from floor plans.

If you cannot find any flooring specifications matching the scope, return:
{
  "conditions": [],
  "measurements": [],
  "calibration": null
}`;
  }

  /**
   * Parse the AI response into structured takeoff data
   */
  private parseTakeoffResponse(response: string): AITakeoffAnalysis {
    try {
      console.log('Parsing Qwen3-VL response:', response);
      
      // Extract JSON from response (handle cases where AI adds extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('No JSON found in AI response. Full response:', response);
        throw new Error('No JSON found in AI response');
      }

      const jsonString = jsonMatch[0];
      console.log('Extracted JSON string:', jsonString);
      
      const parsed = JSON.parse(jsonString);
      console.log('Parsed JSON object:', parsed);
      
      // Validate the response structure
      if (!parsed.conditions || !Array.isArray(parsed.conditions)) {
        throw new Error('Invalid conditions array in response');
      }
      
      if (!parsed.measurements || !Array.isArray(parsed.measurements)) {
        throw new Error('Invalid measurements array in response');
      }

      // Validate each condition
      parsed.conditions.forEach((condition: any, index: number) => {
        if (!condition.name || !condition.type || !condition.unit || !condition.description || !condition.color) {
          throw new Error(`Invalid condition at index ${index}: missing required fields`);
        }
        
        if (!['area', 'volume', 'linear', 'count'].includes(condition.type)) {
          throw new Error(`Invalid condition type at index ${index}: ${condition.type}`);
        }
      });

      // Validate each measurement
      parsed.measurements.forEach((measurement: any, index: number) => {
        if (typeof measurement.conditionIndex !== 'number' || 
            !Array.isArray(measurement.points) || 
            typeof measurement.calculatedValue !== 'number') {
          throw new Error(`Invalid measurement at index ${index}: missing required fields`);
        }
        
        measurement.points.forEach((point: any, pointIndex: number) => {
          if (typeof point.x !== 'number' || typeof point.y !== 'number' ||
              point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
            throw new Error(`Invalid point at measurement ${index}, point ${pointIndex}: coordinates must be 0-1`);
          }
        });
      });

      return {
        conditions: parsed.conditions,
        measurements: parsed.measurements,
        calibration: parsed.calibration || undefined
      };
    } catch (error) {
      console.error('Error parsing Qwen3-VL response:', error);
      console.error('Raw response:', response);
      throw new Error(`Failed to parse AI response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if Qwen3-VL service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      if (!this.apiKey) {
        console.log('No Qwen3-VL API key configured');
        return false;
      }

      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      const models = response.data.models || [];
      const hasQwenVision = models.some((model: any) => 
        model.name === 'qwen2.5-vl:7b' || 
        model.name === 'qwen2.5-vl' ||
        (model.name.includes('qwen') && model.name.includes('vl'))
      );
      
      console.log('Qwen3-VL availability check:', {
        baseUrl: this.baseUrl,
        targetModel: this.model,
        availableModels: models.map((m: any) => m.name),
        hasQwenVision
      });
      
      return hasQwenVision;
    } catch (error) {
      console.warn('Qwen3-VL service not available:', error);
      return false;
    }
  }

  /**
   * Get available Qwen3-VL models
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      if (!this.apiKey) {
        return [];
      }

      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      const models = response.data.models || [];
      return models
        .filter((model: any) => model.name.includes('qwen') && model.name.includes('vl'))
        .map((model: any) => model.name);
    } catch (error) {
      console.error('Error fetching Qwen3-VL models:', error);
      return [];
    }
  }

  /**
   * Convert image buffer to base64 (raw base64 for Ollama API)
   */
  imageToBase64(imageBuffer: Buffer): string {
    // Ollama expects raw base64 without data URL prefix
    return imageBuffer.toString('base64');
  }

  /**
   * Compress image for Qwen3-VL processing (max 1024px width to avoid 503 errors)
   */
  async compressImage(imageBuffer: Buffer, maxWidth: number = 768): Promise<Buffer> {
    try {
      // Use sharp for image compression if available
      const sharp = require('sharp');
      
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      
      // Only compress if image is larger than maxWidth
      if (metadata.width && metadata.width > maxWidth) {
        console.log(`📐 Compressing image from ${metadata.width}x${metadata.height} to max width ${maxWidth}`);
        
        const compressedBuffer = await image
          .resize(maxWidth, null, { 
            withoutEnlargement: true,
            fit: 'inside'
          })
          .jpeg({ 
            quality: 85, // Higher quality for better text readability
            progressive: true 
          })
          .toBuffer();
          
        console.log(`📦 Image compressed: ${imageBuffer.length} bytes → ${compressedBuffer.length} bytes`);
        return compressedBuffer;
      }
      
      // If image is already small enough, just convert to JPEG for better compression
      const jpegBuffer = await image
        .jpeg({ quality: 60 })
        .toBuffer();
        
      console.log(`📦 Image converted to JPEG: ${imageBuffer.length} bytes → ${jpegBuffer.length} bytes`);
      return jpegBuffer;
      
    } catch (error) {
      console.warn('⚠️ Sharp not available or compression failed, using original image:', error);
      return imageBuffer;
    }
  }
}

export const qwenVisionService = new QwenVisionService();
