/**
 * Enhanced Playwright Service for Construction Takeoff
 * 
 * This service provides robust Playwright orchestration with selectors,
 * visual element confirmation, and comprehensive error handling.
 */

import { chromium, Browser, Page, ElementHandle, Locator } from 'playwright';
import { hybridDetectionService } from './hybridDetectionService';
import { ruleBasedValidationService } from './ruleBasedValidationService';

export interface PlaywrightAction {
  type: 'click' | 'type' | 'select' | 'wait' | 'scroll' | 'hover' | 'drag' | 'screenshot';
  selector?: string;
  text?: string;
  value?: string;
  options?: any;
  validation?: {
    expectedText?: string;
    expectedSelector?: string;
    timeout?: number;
  };
}

export interface PlaywrightResult {
  success: boolean;
  action: PlaywrightAction;
  result?: any;
  error?: string;
  screenshot?: string;
  timestamp: number;
}

export interface PlaywrightSession {
  id: string;
  browser: Browser;
  page: Page;
  actions: PlaywrightAction[];
  results: PlaywrightResult[];
  startTime: number;
  status: 'active' | 'completed' | 'failed' | 'paused';
}

export interface TakeoffExecutionPlan {
  steps: PlaywrightAction[];
  validationRules: string[];
  fallbackActions: PlaywrightAction[];
  expectedOutcome: string;
}

class EnhancedPlaywrightService {
  private sessions: Map<string, PlaywrightSession> = new Map();
  private defaultTimeout = 30000; // 30 seconds
  private retryAttempts = 3;
  private retryDelay = 1000; // 1 second

  /**
   * Create a new Playwright session
   */
  async createSession(sessionId: string): Promise<PlaywrightSession> {
    try {
      console.log(`🚀 Creating Playwright session: ${sessionId}`);
      
      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      
      // Set viewport and user agent
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      });

      const session: PlaywrightSession = {
        id: sessionId,
        browser,
        page,
        actions: [],
        results: [],
        startTime: Date.now(),
        status: 'active'
      };

      this.sessions.set(sessionId, session);
      console.log(`✅ Playwright session created: ${sessionId}`);
      
      return session;
    } catch (error) {
      console.error(`❌ Failed to create Playwright session ${sessionId}:`, error);
      throw new Error(`Failed to create Playwright session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute a takeoff plan with enhanced orchestration
   */
  async executeTakeoffPlan(
    sessionId: string,
    plan: TakeoffExecutionPlan,
    imageData: string,
    scope: string
  ): Promise<{
    success: boolean;
    results: PlaywrightResult[];
    takeoffData?: any;
    validationResults?: any;
    error?: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      console.log(`🎯 Executing takeoff plan for session ${sessionId}`);
      console.log(`📋 Plan: ${plan.steps.length} steps, ${plan.validationRules.length} validation rules`);

      // Step 1: Navigate to the takeoff interface
      await this.navigateToTakeoffInterface(session);

      // Step 2: Execute the plan steps
      const results: PlaywrightResult[] = [];
      for (const action of plan.steps) {
        const result = await this.executeAction(session, action);
        results.push(result);
        
        if (!result.success) {
          console.warn(`⚠️ Action failed: ${action.type} - ${result.error}`);
          // Try fallback actions
          const fallbackResult = await this.tryFallbackActions(session, plan.fallbackActions, action);
          if (fallbackResult) {
            results.push(fallbackResult);
          }
        }
      }

      // Step 3: Perform hybrid detection
      console.log('🔍 Performing hybrid detection...');
      const hybridResult = await hybridDetectionService.detectElements(imageData, scope);
      
      // Step 4: Validate results
      console.log('🔍 Validating results...');
      const validationResults = await ruleBasedValidationService.validateTakeoffResults(
        hybridResult.elements,
        hybridResult.scaleInfo,
        hybridResult.ocrData
      );

      // Step 5: Apply results to the interface
      await this.applyTakeoffResults(session, hybridResult, validationResults);

      console.log(`✅ Takeoff plan executed successfully for session ${sessionId}`);
      
      return {
        success: true,
        results,
        takeoffData: hybridResult,
        validationResults
      };

    } catch (error) {
      console.error(`❌ Takeoff plan execution failed for session ${sessionId}:`, error);
      return {
        success: false,
        results: session.results,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Navigate to the takeoff interface
   */
  private async navigateToTakeoffInterface(session: PlaywrightSession): Promise<void> {
    try {
      console.log('🌐 Navigating to takeoff interface...');
      
      // Navigate to the main application
      await session.page.goto('http://localhost:3000', { 
        waitUntil: 'networkidle',
        timeout: this.defaultTimeout 
      });

      // Wait for the application to load
      await session.page.waitForSelector('[data-testid="takeoff-interface"]', { 
        timeout: this.defaultTimeout 
      });

      console.log('✅ Successfully navigated to takeoff interface');
    } catch (error) {
      console.error('❌ Failed to navigate to takeoff interface:', error);
      throw error;
    }
  }

  /**
   * Execute a single Playwright action with enhanced error handling
   */
  private async executeAction(session: PlaywrightSession, action: PlaywrightAction): Promise<PlaywrightResult> {
    const startTime = Date.now();
    
    try {
      console.log(`🎬 Executing action: ${action.type}${action.selector ? ` on ${action.selector}` : ''}`);
      
      let result: any;
      
      switch (action.type) {
        case 'click':
          result = await this.performClick(session, action);
          break;
        case 'type':
          result = await this.performType(session, action);
          break;
        case 'select':
          result = await this.performSelect(session, action);
          break;
        case 'wait':
          result = await this.performWait(session, action);
          break;
        case 'scroll':
          result = await this.performScroll(session, action);
          break;
        case 'hover':
          result = await this.performHover(session, action);
          break;
        case 'drag':
          result = await this.performDrag(session, action);
          break;
        case 'screenshot':
          result = await this.performScreenshot(session, action);
          break;
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      // Validate the action result
      if (action.validation) {
        await this.validateActionResult(session, action, result);
      }

      return {
        success: true,
        action,
        result,
        timestamp: Date.now()
      };

    } catch (error) {
      console.error(`❌ Action failed: ${action.type}`, error);
      return {
        success: false,
        action,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Perform click action with robust selector handling
   */
  private async performClick(session: PlaywrightSession, action: PlaywrightAction): Promise<any> {
    if (!action.selector) {
      throw new Error('Click action requires a selector');
    }

    // Try multiple selector strategies
    const selectors = this.getSelectorStrategies(action.selector);
    
    for (const selector of selectors) {
      try {
        const element = await session.page.waitForSelector(selector, { 
          timeout: 5000,
          state: 'visible'
        });
        
        if (element) {
          await element.click();
          console.log(`✅ Clicked element: ${selector}`);
          return { selector, success: true };
        }
      } catch (error) {
        console.log(`⚠️ Selector failed: ${selector}`);
        continue;
      }
    }

    throw new Error(`Could not find clickable element for selector: ${action.selector}`);
  }

  /**
   * Perform type action with validation
   */
  private async performType(session: PlaywrightSession, action: PlaywrightAction): Promise<any> {
    if (!action.selector || !action.text) {
      throw new Error('Type action requires a selector and text');
    }

    const element = await session.page.waitForSelector(action.selector, { 
      timeout: this.defaultTimeout,
      state: 'visible'
    });

    if (!element) {
      throw new Error(`Element not found: ${action.selector}`);
    }

    // Clear existing text
    await element.fill('');
    
    // Type the text
    await element.type(action.text, { delay: 100 });
    
    // Validate the input
    const value = await element.inputValue();
    if (value !== action.text) {
      throw new Error(`Text input validation failed. Expected: ${action.text}, Got: ${value}`);
    }

    console.log(`✅ Typed text: ${action.text}`);
    return { selector: action.selector, text: action.text, success: true };
  }

  /**
   * Perform select action
   */
  private async performSelect(session: PlaywrightSession, action: PlaywrightAction): Promise<any> {
    if (!action.selector || !action.value) {
      throw new Error('Select action requires a selector and value');
    }

    const element = await session.page.waitForSelector(action.selector, { 
      timeout: this.defaultTimeout,
      state: 'visible'
    });

    if (!element) {
      throw new Error(`Element not found: ${action.selector}`);
    }

    await element.selectOption(action.value);
    
    // Validate the selection
    const selectedValue = await element.inputValue();
    if (selectedValue !== action.value) {
      throw new Error(`Selection validation failed. Expected: ${action.value}, Got: ${selectedValue}`);
    }

    console.log(`✅ Selected option: ${action.value}`);
    return { selector: action.selector, value: action.value, success: true };
  }

  /**
   * Perform wait action
   */
  private async performWait(session: PlaywrightSession, action: PlaywrightAction): Promise<any> {
    const timeout = action.options?.timeout || 5000;
    
    if (action.selector) {
      await session.page.waitForSelector(action.selector, { timeout });
    } else {
      await session.page.waitForTimeout(timeout);
    }

    console.log(`✅ Waited for ${timeout}ms`);
    return { timeout, success: true };
  }

  /**
   * Perform scroll action
   */
  private async performScroll(session: PlaywrightSession, action: PlaywrightAction): Promise<any> {
    const x = action.options?.x || 0;
    const y = action.options?.y || 0;
    
    await session.page.mouse.wheel(x, y);
    
    console.log(`✅ Scrolled by (${x}, ${y})`);
    return { x, y, success: true };
  }

  /**
   * Perform hover action
   */
  private async performHover(session: PlaywrightSession, action: PlaywrightAction): Promise<any> {
    if (!action.selector) {
      throw new Error('Hover action requires a selector');
    }

    const element = await session.page.waitForSelector(action.selector, { 
      timeout: this.defaultTimeout,
      state: 'visible'
    });

    if (!element) {
      throw new Error(`Element not found: ${action.selector}`);
    }

    await element.hover();
    
    console.log(`✅ Hovered over: ${action.selector}`);
    return { selector: action.selector, success: true };
  }

  /**
   * Perform drag action
   */
  private async performDrag(session: PlaywrightSession, action: PlaywrightAction): Promise<any> {
    if (!action.selector || !action.options?.targetSelector) {
      throw new Error('Drag action requires a selector and targetSelector');
    }

    const sourceElement = await session.page.waitForSelector(action.selector, { 
      timeout: this.defaultTimeout,
      state: 'visible'
    });

    const targetElement = await session.page.waitForSelector(action.options.targetSelector, { 
      timeout: this.defaultTimeout,
      state: 'visible'
    });

    if (!sourceElement || !targetElement) {
      throw new Error('Source or target element not found for drag operation');
    }

    // Get bounding boxes for drag operation
    const sourceBox = await sourceElement.boundingBox();
    const targetBox = await targetElement.boundingBox();
    
    if (!sourceBox || !targetBox) {
      throw new Error('Could not get bounding boxes for drag operation');
    }
    
    // Perform drag operation using mouse
    await session.page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await session.page.mouse.down();
    await session.page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
    await session.page.mouse.up();
    
    console.log(`✅ Dragged from ${action.selector} to ${action.options.targetSelector}`);
    return { 
      sourceSelector: action.selector, 
      targetSelector: action.options.targetSelector, 
      success: true 
    };
  }

  /**
   * Perform screenshot action
   */
  private async performScreenshot(session: PlaywrightSession, action: PlaywrightAction): Promise<any> {
    const screenshot = await session.page.screenshot({
      fullPage: action.options?.fullPage || false,
      type: 'png'
    });

    const base64 = screenshot.toString('base64');
    
    console.log(`✅ Screenshot captured`);
    return { screenshot: base64, success: true };
  }

  /**
   * Get multiple selector strategies for robust element finding
   */
  private getSelectorStrategies(selector: string): string[] {
    return [
      selector, // Original selector
      `[data-testid="${selector}"]`, // Test ID
      `[data-cy="${selector}"]`, // Cypress selector
      `#${selector}`, // ID selector
      `.${selector}`, // Class selector
      `[name="${selector}"]`, // Name attribute
      `[aria-label="${selector}"]`, // ARIA label
      `[title="${selector}"]`, // Title attribute
      `text=${selector}`, // Text content
      `[placeholder="${selector}"]` // Placeholder text
    ];
  }

  /**
   * Validate action result
   */
  private async validateActionResult(session: PlaywrightSession, action: PlaywrightAction, result: any): Promise<void> {
    if (!action.validation) return;

    const { expectedText, expectedSelector, timeout = 5000 } = action.validation;

    if (expectedText) {
      const element = await session.page.waitForSelector(expectedSelector || action.selector!, { timeout });
      const text = await element.textContent();
      
      if (!text?.includes(expectedText)) {
        throw new Error(`Validation failed: Expected text "${expectedText}" not found. Got: "${text}"`);
      }
    }

    if (expectedSelector) {
      const element = await session.page.waitForSelector(expectedSelector, { timeout });
      if (!element) {
        throw new Error(`Validation failed: Expected selector "${expectedSelector}" not found`);
      }
    }
  }

  /**
   * Try fallback actions when primary action fails
   */
  private async tryFallbackActions(
    session: PlaywrightSession, 
    fallbackActions: PlaywrightAction[], 
    failedAction: PlaywrightAction
  ): Promise<PlaywrightResult | null> {
    console.log(`🔄 Trying fallback actions for failed action: ${failedAction.type}`);
    
    for (const fallbackAction of fallbackActions) {
      try {
        const result = await this.executeAction(session, fallbackAction);
        if (result.success) {
          console.log(`✅ Fallback action succeeded: ${fallbackAction.type}`);
          return result;
        }
      } catch (error) {
        console.log(`⚠️ Fallback action failed: ${fallbackAction.type}`);
        continue;
      }
    }

    console.log(`❌ All fallback actions failed for: ${failedAction.type}`);
    return null;
  }

  /**
   * Apply takeoff results to the interface
   */
  private async applyTakeoffResults(
    session: PlaywrightSession, 
    takeoffData: any, 
    validationResults: any
  ): Promise<void> {
    try {
      console.log('📊 Applying takeoff results to interface...');
      
      // Apply conditions
      for (const condition of takeoffData.conditions) {
        await this.createCondition(session, condition);
      }

      // Apply measurements
      for (const measurement of takeoffData.measurements) {
        await this.createMeasurement(session, measurement);
      }

      // Apply validation feedback
      if (!validationResults.overallValid) {
        await this.showValidationFeedback(session, validationResults);
      }

      console.log('✅ Takeoff results applied successfully');
    } catch (error) {
      console.error('❌ Failed to apply takeoff results:', error);
      throw error;
    }
  }

  /**
   * Create a condition in the interface
   */
  private async createCondition(session: PlaywrightSession, condition: any): Promise<void> {
    // Click add condition button
    await session.page.click('[data-testid="add-condition-button"]');
    
    // Fill condition form
    await session.page.fill('[data-testid="condition-name"]', condition.name);
    await session.page.selectOption('[data-testid="condition-type"]', condition.type);
    await session.page.fill('[data-testid="condition-unit"]', condition.unit);
    await session.page.fill('[data-testid="condition-description"]', condition.description);
    
    // Save condition
    await session.page.click('[data-testid="save-condition-button"]');
  }

  /**
   * Create a measurement in the interface
   */
  private async createMeasurement(session: PlaywrightSession, measurement: any): Promise<void> {
    // Click add measurement button
    await session.page.click('[data-testid="add-measurement-button"]');
    
    // Fill measurement form
    await session.page.fill('[data-testid="measurement-value"]', measurement.calculatedValue.toString());
    await session.page.selectOption('[data-testid="measurement-unit"]', measurement.unit);
    
    // Save measurement
    await session.page.click('[data-testid="save-measurement-button"]');
  }

  /**
   * Show validation feedback in the interface
   */
  private async showValidationFeedback(session: PlaywrightSession, validationResults: any): Promise<void> {
    // Show validation panel
    await session.page.click('[data-testid="validation-panel-toggle"]');
    
    // Display errors
    for (const error of validationResults.errors) {
      await session.page.fill('[data-testid="validation-error"]', error.message);
    }
    
    // Display warnings
    for (const warning of validationResults.warnings) {
      await session.page.fill('[data-testid="validation-warning"]', warning.message);
    }
    
    // Display suggestions
    for (const suggestion of validationResults.suggestions) {
      await session.page.fill('[data-testid="validation-suggestion"]', suggestion);
    }
  }

  /**
   * Close a Playwright session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`Session ${sessionId} not found for closing`);
      return;
    }

    try {
      await session.browser.close();
      this.sessions.delete(sessionId);
      console.log(`✅ Session ${sessionId} closed successfully`);
    } catch (error) {
      console.error(`❌ Failed to close session ${sessionId}:`, error);
    }
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): PlaywrightSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * List all active sessions
   */
  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Check if service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      return true;
    } catch (error) {
      console.warn('Playwright not available:', error);
      return false;
    }
  }
}

export const enhancedPlaywrightService = new EnhancedPlaywrightService();
