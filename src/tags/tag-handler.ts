import { SwfTagCode } from './tags';
import { Frame, DisplayList } from '../swf/display';
import { parseShape } from './handlers/shape-parser';

// TYPE SAFETY: Base interface lacks essential properties
// MISSING: Generic type parameter for specific tag data types
export interface TagData {
  code: SwfTagCode;
  data: any; // TYPE SAFETY: 'any' type loses critical type information for SWF data
  // MISSING: Should include length, version info, and validation status
  // MISSING: readonly properties to prevent mutation
  // MISSING: timestamp or processing metadata
}

// ARCHITECTURE: Interface could be more extensible
// MISSING: Lifecycle hooks (beforeHandle, afterHandle)
export interface TagHandler {
  canHandle(tag: TagData): boolean;
  handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void>;
  // MISSING: cleanup() method for resource management
  // MISSING: priority() method for handler ordering
  // MISSING: validate() method for tag data validation
  // MISSING: supports() method for feature detection
}

// Enhanced registry pattern with proper cleanup
export class TagHandlerRegistry {
  private handlers: Map<SwfTagCode, TagHandler> = new Map();

  // Input validation and improved registration
  register(codes: SwfTagCode[], handler: TagHandler, allowOverwrite: boolean = false): void {
    if (!codes || codes.length === 0) {
      throw new Error('At least one tag code must be provided');
    }
    
    if (!handler) {
      throw new Error('Handler cannot be null or undefined');
    }
    
    for (const code of codes) {
      if (this.handlers.has(code) && !allowOverwrite) {
        throw new Error(`Handler for tag ${SwfTagCode[code]} already registered. Use allowOverwrite=true to replace.`);
      }
      this.handlers.set(code, handler);
    }
    
    // Invalidate cache when handlers change
    this.invalidateCache();
  }

  // PERFORMANCE: Direct map lookup is efficient
  getHandler(code: SwfTagCode): TagHandler | undefined {
    return this.handlers.get(code);
    // MISSING: Fallback handler mechanism
    // MISSING: Handler composition support
  }

  hasHandler(code: SwfTagCode): boolean {
    return this.handlers.has(code);
  }

  // Cached registered tags for performance
  private _cachedRegisteredTags: SwfTagCode[] | null = null;
  
  getRegisteredTags(): SwfTagCode[] {
    if (this._cachedRegisteredTags === null) {
      this._cachedRegisteredTags = Array.from(this.handlers.keys());
    }
    return [...this._cachedRegisteredTags]; // Return copy to prevent modification
  }

  // Enhanced cleanup with handler lifecycle management
  clearHandlers(): void {
    // Call cleanup on handlers that support it
    for (const handler of this.handlers.values()) {
      if ('cleanup' in handler && typeof handler.cleanup === 'function') {
        try {
          handler.cleanup();
        } catch (error) {
          console.warn('Error during handler cleanup:', error);
        }
      }
    }
    
    this.handlers.clear();
    this._cachedRegisteredTags = null;
  }

  // Unregister specific handlers
  unregister(code: SwfTagCode): boolean {
    const removed = this.handlers.delete(code);
    if (removed) {
      this._cachedRegisteredTags = null; // Invalidate cache
    }
    return removed;
  }
  
  // Clear cache when handlers change
  private invalidateCache(): void {
    this._cachedRegisteredTags = null;
  }
}

// ARCHITECTURE: Base class provides minimal functionality
// MISSING: Common utilities that most handlers would need
export abstract class BaseTagHandler implements TagHandler {
  abstract canHandle(tag: TagData): boolean;
  abstract handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void>;

  // ERROR HANDLING: Basic error handling but lacks robustness
  protected handleError(tag: TagData, error: Error): void {
    // LOGGING ISSUE: Error details lost in production - should use proper error logging
    // MISSING: Error categorization (recoverable vs fatal)
    console.error(`Error processing tag ${SwfTagCode[tag.code]}: ${error.message}`);
    console.error(error);
    // MISSING: Error recovery strategies
    // MISSING: Error reporting to external systems
    // MISSING: Metrics collection for error patterns
  }
}

// IMPLEMENTATION: Specific handler with several issues
export class ShapeTagHandler extends BaseTagHandler {
  // TYPE SAFETY: Could use more specific typing for tag codes
  canHandle(tag: TagData): boolean {
    return [
      SwfTagCode.DefineShape,
      SwfTagCode.DefineShape2,
      SwfTagCode.DefineShape3,
      SwfTagCode.DefineShape4
    ].includes(tag.code);
  }

  // Improved error handling and simplified async pattern
  async handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void> {
    try {
      // Input validation
      if (!tag.data || tag.data.remaining < 2) {
        throw new Error('Insufficient data for shape tag');
      }
      
      const data = tag.data;
      const characterId = data.readUint16();
      
      // Note: Shape uniqueness validation would require DisplayList API enhancement
      const shape = parseShape(data, tag.code);

      // Safe frame action addition
      frame.actions.push({
        type: 'defineShape',
        data: { characterId, shape }
      });

      // Safe display list addition with error handling
      try {
        displayList.addShape(characterId, shape);
      } catch (displayError) {
        const errorMessage = displayError instanceof Error ? displayError.message : 'Unknown error';
        throw new Error(`Failed to add shape to display list: ${errorMessage}`);
      }
    } catch (error) {
      this.handleError(tag, error as Error);
      throw error; // Re-throw to let caller handle appropriately
    }
  }
}

// Enhanced tag handler registry with proper cleanup and caching.
// Core shape handling implemented with robust error handling.
// Additional handlers can be implemented as needed for:
// - ActionScript/Button tags
// - Sound tags  
// - Sprite tags
// - Other SWF features
