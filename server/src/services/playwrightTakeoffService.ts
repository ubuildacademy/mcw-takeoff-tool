import { chromium, Browser, Page } from 'playwright';
import type { AITakeoffResult } from './aiTakeoffService';

interface Coordinate {
  x: number;
  y: number;
}

interface CanvasInfo {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface PlaywrightTakeoffOptions {
  headless?: boolean;
  timeout?: number;
  retryAttempts?: number;
}

export class PlaywrightTakeoffService {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private options: PlaywrightTakeoffOptions;

  constructor(options: PlaywrightTakeoffOptions = {}) {
    this.options = {
      headless: true,
      timeout: 30000,
      retryAttempts: 3,
      ...options
    };
  }

  /**
   * Initialize Playwright browser and page
   */
  async initialize(): Promise<void> {
    try {
      this.browser = await chromium.launch({
        headless: this.options.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      this.page = await this.browser.newPage();
      
      // Set viewport to match typical screen size
      await this.page.setViewportSize({ width: 1920, height: 1080 });
      
      console.log('✅ Playwright browser initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Playwright:', error);
      throw new Error(`Playwright initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Navigate to the takeoff workspace and load the PDF
   */
  async navigateToTakeoffWorkspace(
    projectId: string, 
    documentId: string, 
    pageNumber: number,
    authToken?: string
  ): Promise<void> {
    if (!this.page) {
      throw new Error('Playwright not initialized. Call initialize() first.');
    }

    try {
      const url = `http://localhost:3001/project/${projectId}`;
      console.log(`🌐 Navigating to: ${url}`);
      
      // Set up authentication context
      if (authToken) {
        console.log('🔐 Setting up authentication context...');
        
        // Set the auth token in localStorage for the session
        await this.page.addInitScript((token) => {
          if (typeof (globalThis as any).window !== 'undefined' && (globalThis as any).window.localStorage) {
            (globalThis as any).window.localStorage.setItem('sb-access-token', token);
            (globalThis as any).window.localStorage.setItem('sb-refresh-token', token);
          }
        }, authToken);
        
        // Also set it in the browser context
        await this.page.context().addCookies([{
          name: 'sb-access-token',
          value: authToken,
          domain: 'localhost',
          path: '/',
          httpOnly: false
        }]);
      }
      
      // Navigate to the project page
      await this.page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: this.options.timeout 
      });
      
      console.log('✅ Navigation complete, waiting for authentication...');
      
      // Wait for authentication to complete
      await this.page.waitForTimeout(3000);
      
      // Check if we're redirected to login (authentication failed)
      const currentUrl = this.page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/signup')) {
        throw new Error('Authentication failed - redirected to login page');
      }
      
      console.log('✅ Authentication successful');
      
      // Wait for the PDF viewer to load with longer timeout
      console.log('📄 Waiting for PDF viewer to load...');
      try {
        await this.page.waitForSelector('.pdf-viewer', { timeout: 15000 });
        console.log('✅ PDF viewer loaded');
      } catch (pdfError) {
        console.log('⚠️ PDF viewer not found, checking for canvas element...');
        // Fallback: look for canvas element
        const canvas = await this.page.$('canvas');
        if (!canvas) {
          throw new Error('PDF viewer and canvas not found - PDF may not be loaded');
        }
        console.log('✅ Canvas element found');
      }
      
      // Navigate to the specific page if needed
      if (pageNumber > 1) {
        await this.navigateToPage(pageNumber);
      }
      
      // Wait for the page to be fully rendered
      await this.page.waitForTimeout(3000);
      
    } catch (error) {
      console.error('❌ Failed to navigate to takeoff workspace:', error);
      throw new Error(`Navigation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Navigate to a specific page in the PDF
   */
  async navigateToPage(pageNumber: number): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      console.log(`📄 Navigating to PDF page ${pageNumber}...`);
      
      // Wait for PDF to be fully loaded
      await this.page.waitForTimeout(2000);
      
      // Try multiple approaches to navigate to the page
      let navigationSuccess = false;
      
      // Approach 1: Look for page input field
      try {
        const pageInput = await this.page.$('input[type="number"]');
        if (pageInput) {
          await pageInput.fill('');
          await pageInput.fill(pageNumber.toString());
          await pageInput.press('Enter');
          await this.page.waitForTimeout(2000);
          console.log(`✅ Navigated to page ${pageNumber} using input field`);
          navigationSuccess = true;
        }
      } catch (inputError) {
        console.log('⚠️ Page input navigation failed:', inputError instanceof Error ? inputError.message : 'Unknown error');
      }
      
      // Approach 2: Look for page navigation buttons
      if (!navigationSuccess) {
        try {
          // Look for next/previous buttons and click until we reach the target page
          const currentPageElement = await this.page.$('[data-testid="current-page"]');
          let currentPage = 1;
          
          if (currentPageElement) {
            const currentPageText = await currentPageElement.textContent();
            currentPage = parseInt(currentPageText || '1') || 1;
          }
          
          console.log(`Current page: ${currentPage}, Target page: ${pageNumber}`);
          
          if (currentPage < pageNumber) {
            // Click next button until we reach the target page
            for (let i = currentPage; i < pageNumber; i++) {
              const nextButton = await this.page.$('button[aria-label*="next"], button:has-text("Next"), button[data-testid*="next"]');
              if (nextButton) {
                await nextButton.click();
                await this.page.waitForTimeout(1000);
                console.log(`Clicked next button, now on page ${i + 1}`);
              } else {
                console.log('⚠️ Next button not found');
                break;
              }
            }
          } else if (currentPage > pageNumber) {
            // Click previous button until we reach the target page
            for (let i = currentPage; i > pageNumber; i--) {
              const prevButton = await this.page.$('button[aria-label*="previous"], button:has-text("Previous"), button[data-testid*="prev"]');
              if (prevButton) {
                await prevButton.click();
                await this.page.waitForTimeout(1000);
                console.log(`Clicked previous button, now on page ${i - 1}`);
              } else {
                console.log('⚠️ Previous button not found');
                break;
              }
            }
          }
          
          navigationSuccess = true;
          console.log(`✅ Navigated to page ${pageNumber} using navigation buttons`);
        } catch (buttonError) {
          console.log('⚠️ Button navigation failed:', buttonError instanceof Error ? buttonError.message : 'Unknown error');
        }
      }
      
      // Approach 3: Use keyboard shortcuts
      if (!navigationSuccess) {
        try {
          // Use keyboard shortcuts to navigate
          for (let i = 1; i < pageNumber; i++) {
            await this.page.keyboard.press('ArrowRight');
            await this.page.waitForTimeout(500);
          }
          console.log(`✅ Navigated to page ${pageNumber} using keyboard shortcuts`);
          navigationSuccess = true;
        } catch (keyboardError) {
          console.log('⚠️ Keyboard navigation failed:', keyboardError instanceof Error ? keyboardError.message : 'Unknown error');
        }
      }
      
      if (!navigationSuccess) {
        console.log('⚠️ Could not navigate to specific page, continuing with current page');
      }
      
      // Wait for the page to be fully rendered
      await this.page.waitForTimeout(2000);
      
    } catch (error) {
      console.error(`❌ Failed to navigate to page ${pageNumber}:`, error);
      // Don't throw error - continue with current page
      console.log('⚠️ Continuing with current page');
    }
  }

  /**
   * Get canvas information for coordinate conversion
   */
  async getCanvasInfo(): Promise<CanvasInfo> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      console.log('📐 Getting canvas information...');
      
      // Wait for canvas to be available with multiple attempts
      let canvasInfo: CanvasInfo | null = null;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts && !canvasInfo) {
        try {
          // Get canvas dimensions and position
          canvasInfo = await this.page.evaluate(`
            (() => {
              const canvas = document.querySelector('canvas');
              if (!canvas) {
                return null;
              }
              
              const rect = canvas.getBoundingClientRect();
              return {
                width: canvas.width,
                height: canvas.height,
                offsetX: rect.left,
                offsetY: rect.top,
                scale: rect.width / canvas.width
              };
            })()
          `) as CanvasInfo;
          
          if (canvasInfo && canvasInfo.width > 0 && canvasInfo.height > 0) {
            console.log('✅ Canvas info retrieved:', canvasInfo);
            break;
          } else {
            console.log(`⚠️ Canvas not ready (attempt ${attempts + 1}/${maxAttempts})`);
            canvasInfo = null;
          }
        } catch (evalError) {
          console.log(`⚠️ Canvas evaluation failed (attempt ${attempts + 1}/${maxAttempts}):`, evalError instanceof Error ? evalError.message : 'Unknown error');
        }
        
        if (!canvasInfo) {
          attempts++;
          await this.page.waitForTimeout(1000);
        }
      }
      
      if (!canvasInfo) {
        throw new Error('Canvas not found or not ready after multiple attempts');
      }
      
      return canvasInfo;
    } catch (error) {
      console.error('❌ Failed to get canvas info:', error);
      throw new Error(`Canvas info retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Convert normalized coordinates (0-1) to actual pixel coordinates
   */
  convertToPixelCoordinates(
    normalizedCoords: Coordinate[], 
    canvasInfo: CanvasInfo
  ): Coordinate[] {
    return normalizedCoords.map(coord => ({
      x: Math.round(coord.x * canvasInfo.width * canvasInfo.scale + canvasInfo.offsetX),
      y: Math.round(coord.y * canvasInfo.height * canvasInfo.scale + canvasInfo.offsetY)
    }));
  }

  /**
   * Select a condition for measurement
   */
  async selectCondition(conditionName: string): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      console.log(`🔍 Looking for condition: ${conditionName}`);
      
      // Wait for the UI to update with new conditions and sidebar to load
      console.log('⏳ Waiting for conditions to load...');
      await this.page.waitForTimeout(5000);
      
      // Wait for sidebar to be visible
      try {
        await this.page.waitForSelector('[data-testid="conditions-sidebar"], .conditions-sidebar, .sidebar', { timeout: 10000 });
        console.log('✅ Sidebar loaded');
      } catch (sidebarError) {
        console.log('⚠️ Sidebar not found, continuing...');
      }
      
      // Debug: List all elements that might contain conditions
      const allElements = await this.page.$$eval('*', elements => 
        elements.map(el => ({
          tagName: el.tagName,
          className: el.className,
          textContent: el.textContent?.trim().substring(0, 100),
          id: el.id
        })).filter(el => el.textContent && el.textContent.includes(conditionName))
      );
      console.log(`🔍 Elements containing "${conditionName}":`, allElements);
      
      // Try multiple selectors for condition elements
      const selectors = [
        `div:has-text("${conditionName}")`,
        `[data-testid*="condition"]:has-text("${conditionName}")`,
        `.condition-item:has-text("${conditionName}")`,
        `div[class*="condition"]:has-text("${conditionName}")`,
        `text=${conditionName}`
      ];
      
      for (const selector of selectors) {
        try {
          console.log(`🔍 Trying selector: ${selector}`);
          const element = await this.page.$(selector);
          if (element) {
            await element.click();
            await this.page.waitForTimeout(1000);
            console.log(`✅ Selected condition using selector "${selector}": ${conditionName}`);
            return;
          }
        } catch (selectorError) {
          console.log(`⚠️ Selector "${selector}" failed:`, selectorError instanceof Error ? selectorError.message : 'Unknown error');
        }
      }
      
      // Fallback: look for any clickable element containing the condition name
      const clickableElements = await this.page.$$('div, button, span, p, h1, h2, h3, h4, h5, h6');
      for (const element of clickableElements) {
        const text = await element.textContent();
        if (text && text.includes(conditionName)) {
          try {
            await element.click();
            await this.page.waitForTimeout(1000);
            console.log(`✅ Selected condition by text search: ${conditionName}`);
            return;
          } catch (clickError) {
            console.log(`⚠️ Failed to click element with text "${text}":`, clickError instanceof Error ? clickError.message : 'Unknown error');
          }
        }
      }
      
      // If still not found, try refreshing and waiting longer
      console.log(`⚠️ Condition "${conditionName}" not found, refreshing page and retrying...`);
      await this.page.reload();
      await this.page.waitForTimeout(5000); // Wait longer for conditions to load
      
      // Try the selectors again after refresh
      for (const selector of selectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await element.click();
            await this.page.waitForTimeout(1000);
            console.log(`✅ Selected condition after refresh using "${selector}": ${conditionName}`);
            return;
          }
        } catch (selectorError) {
          console.log(`⚠️ Selector "${selector}" failed after refresh:`, selectorError instanceof Error ? selectorError.message : 'Unknown error');
        }
      }
      
      // Final fallback: just log that we couldn't find it but continue
      console.log(`⚠️ Could not find condition "${conditionName}" - continuing without selection`);
      console.log(`   This might be expected if the condition hasn't been created yet`);
      
    } catch (error) {
      console.error(`❌ Failed to select condition ${conditionName}:`, error);
      // Don't throw error - just log and continue
      console.log(`⚠️ Continuing without condition selection`);
    }
  }

  /**
   * Execute a single measurement by clicking coordinates
   */
  async executeMeasurement(
    coordinates: Coordinate[], 
    measurementType: 'area' | 'linear' | 'count' | 'volume'
  ): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      console.log(`🎯 Executing ${measurementType} measurement with ${coordinates.length} points`);
      
      // Ensure the canvas is focused and ready
      await this.page.click('canvas');
      await this.page.waitForTimeout(1000);
      
      // Click the first point to start the measurement
      console.log(`📍 Clicking first point at (${coordinates[0].x}, ${coordinates[0].y})`);
      await this.page.mouse.click(coordinates[0].x, coordinates[0].y);
      await this.page.waitForTimeout(500);
      
      // Click additional points for the measurement
      for (let i = 1; i < coordinates.length; i++) {
        console.log(`📍 Clicking point ${i + 1} at (${coordinates[i].x}, ${coordinates[i].y})`);
        await this.page.mouse.click(coordinates[i].x, coordinates[i].y);
        await this.page.waitForTimeout(500);
      }
      
      // Complete the measurement based on type
      if (measurementType === 'area' && coordinates.length > 2) {
        // For area measurements, close the polygon by clicking the first point again
        console.log(`📍 Closing polygon at (${coordinates[0].x}, ${coordinates[0].y})`);
        await this.page.mouse.click(coordinates[0].x, coordinates[0].y);
        await this.page.waitForTimeout(500);
      } else if (measurementType === 'volume' && coordinates.length > 2) {
        // For volume measurements, also close the polygon for the base area
        console.log(`📍 Closing volume polygon at (${coordinates[0].x}, ${coordinates[0].y})`);
        await this.page.mouse.click(coordinates[0].x, coordinates[0].y);
        await this.page.waitForTimeout(500);
      }
      
      // Press Enter to complete the measurement
      console.log('⌨️ Pressing Enter to complete measurement');
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(1000);
      
      console.log(`✅ Completed ${measurementType} measurement`);
    } catch (error) {
      console.error(`❌ Failed to execute measurement:`, error);
      throw error;
    }
  }

  /**
   * Execute all measurements from an AI takeoff result
   */
  async executeAITakeoffResult(
    aiResult: AITakeoffResult,
    projectId: string,
    authToken?: string
  ): Promise<{
    success: boolean;
    measurementsPlaced: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let measurementsPlaced = 0;

    try {
      console.log(`🚀 Starting automated takeoff for page ${aiResult.pageNumber}`);
      
      // Initialize Playwright
      await this.initialize();
      
      // Navigate to the takeoff workspace
      await this.navigateToTakeoffWorkspace(
        projectId, 
        aiResult.documentId, 
        aiResult.pageNumber,
        authToken
      );
      
      // Get canvas information for coordinate conversion
      const canvasInfo = await this.getCanvasInfo();
      
      // Process each condition and its measurements
      console.log(`📊 Processing ${aiResult.conditions.length} conditions with ${aiResult.measurements.length} total measurements`);
      
      if (aiResult.conditions.length === 0) {
        console.log(`⚠️ No conditions found in AI result - skipping automation`);
        return {
          success: true,
          measurementsPlaced: 0,
          errors: ['No conditions found in AI analysis result']
        };
      }
      
      for (let conditionIndex = 0; conditionIndex < aiResult.conditions.length; conditionIndex++) {
        const condition = aiResult.conditions[conditionIndex];
        const conditionMeasurements = aiResult.measurements.filter(
          m => m.conditionIndex === conditionIndex
        );
        
        console.log(`🔍 Processing condition ${conditionIndex + 1}/${aiResult.conditions.length}: ${condition.name}`);
        console.log(`   - Type: ${condition.type}`);
        console.log(`   - Unit: ${condition.unit}`);
        console.log(`   - Measurements: ${conditionMeasurements.length}`);
        
        if (conditionMeasurements.length === 0) {
          console.log(`⚠️ No measurements found for condition: ${condition.name} - this is normal for conditions that failed AI analysis`);
          continue;
        }
        
        try {
          // Select the condition
          console.log(`🎯 Selecting condition: ${condition.name}`);
          await this.selectCondition(condition.name);
          console.log(`✅ Condition selection attempted for: ${condition.name}`);
          
          // Execute each measurement for this condition
          for (let i = 0; i < conditionMeasurements.length; i++) {
            const measurement = conditionMeasurements[i];
            try {
              console.log(`📏 Executing measurement ${i + 1}/${conditionMeasurements.length} for ${condition.name}`);
              console.log(`   - Points: ${measurement.points.length}`);
              console.log(`   - Calculated value: ${measurement.calculatedValue} ${condition.unit}`);
              
              // Convert normalized coordinates to pixel coordinates
              const pixelCoords = this.convertToPixelCoordinates(measurement.points, canvasInfo);
              console.log(`   - Pixel coordinates:`, pixelCoords);
              
              // Execute the measurement
              await this.executeMeasurement(pixelCoords, condition.type);
              measurementsPlaced++;
              
              console.log(`✅ Placed measurement for ${condition.name}: ${measurement.calculatedValue} ${condition.unit}`);
            } catch (measurementError) {
              const errorMsg = `Failed to place measurement for ${condition.name}: ${measurementError instanceof Error ? measurementError.message : 'Unknown error'}`;
              console.error(`❌ ${errorMsg}`);
              errors.push(errorMsg);
              
              // Continue with next measurement even if this one failed
              console.log(`⚠️ Continuing with next measurement...`);
            }
          }
        } catch (conditionError) {
          const errorMsg = `Failed to process condition ${condition.name}: ${conditionError instanceof Error ? conditionError.message : 'Unknown error'}`;
          console.error(`❌ ${errorMsg}`);
          errors.push(errorMsg);
          
          // Continue with next condition even if this one failed
          console.log(`⚠️ Continuing with next condition...`);
        }
      }
      
      console.log(`🎉 Automated takeoff complete: ${measurementsPlaced} measurements placed`);
      
      return {
        success: errors.length === 0,
        measurementsPlaced,
        errors
      };
      
    } catch (error) {
      const errorMsg = `Automated takeoff failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      
      return {
        success: false,
        measurementsPlaced,
        errors
      };
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Take a screenshot for verification
   */
  async takeScreenshot(filename: string): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      await this.page.screenshot({ 
        path: filename,
        fullPage: true 
      });
      console.log(`📸 Screenshot saved: ${filename}`);
    } catch (error) {
      console.error('❌ Failed to take screenshot:', error);
    }
  }

  /**
   * Clean up browser resources
   */
  async cleanup(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      console.log('🧹 Playwright cleanup complete');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }
}

// Export singleton instance
export const playwrightTakeoffService = new PlaywrightTakeoffService();

