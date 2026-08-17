import type { Message, ToolDefinition } from '../agent/types.ts';
import type { Provider } from '../providers/base.ts';
import { ContextCompactor, type CompactorConfig } from './compactor.ts';
import { InjectionScanner } from './injection-scanner.ts';
import { assembleContext } from './tiers.ts';

export class ContextManager {
  private compactor: ContextCompactor;
  private scanner: InjectionScanner;
  private conversationHistory: Message[] = [];
  private projectRoot: string;
  private maxTokens: number;
  
  constructor(config: { projectRoot: string; maxTokens?: number }) {
    this.projectRoot = config.projectRoot;
    this.maxTokens = config.maxTokens || 128000; // Default reasonable value
    
    this.compactor = new ContextCompactor({
      maxTokens: this.maxTokens,
      warningThreshold: 0.5,
      criticalThreshold: 0.85,
      protectedHeadCount: 3,
      protectedTailCount: 3
    });
    
    this.scanner = new InjectionScanner();
  }
  
  public addMessage(message: Message): void {
    this.conversationHistory.push(message);
  }
  
  public async getContext(toolDefinitions?: ToolDefinition[]): Promise<Message[]> {
    const fullContext = await assembleContext({
      stableConfig: {
        toolDefinitions
      },
      projectRoot: this.projectRoot,
      conversationHistory: this.conversationHistory,
      scanner: this.scanner
    });
    
    const needsCompaction = this.compactor.needsCompaction(fullContext);
    if (needsCompaction === 'critical') {
       // Ideally we'd compact automatically here, but we will just return full and expect caller to handle
    }
    
    return fullContext;
  }
  
  public async compact(summaryProvider?: Provider): Promise<void> {
    this.conversationHistory = await this.compactor.compact(this.conversationHistory, summaryProvider);
  }
  
  public getTokenUsage(): { estimated: number; budget: number; percentage: number } {
    const estimated = this.compactor.estimateTokens(this.conversationHistory);
    return {
      estimated,
      budget: this.maxTokens,
      percentage: (estimated / this.maxTokens) * 100
    };
  }
  
  public reset(): void {
    this.conversationHistory = [];
  }
}
