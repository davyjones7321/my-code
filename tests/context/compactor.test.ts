import { describe, it, expect } from 'bun:test';
import { ContextCompactor } from '../../src/context/compactor.ts';
import type { Message } from '../../src/agent/types.ts';

describe('ContextCompactor', () => {
  const config = {
    maxTokens: 100,
    warningThreshold: 0.5,
    criticalThreshold: 0.85,
    protectedHeadCount: 1,
    protectedTailCount: 1
  };

  it('estimateTokens returns reasonable estimates', () => {
    const compactor = new ContextCompactor(config);
    const msgs: Message[] = [
      { role: 'user', content: [{ type: 'text', text: '1234' }] }
    ];
    // 4 chars = ~1 token
    expect(compactor.estimateTokens(msgs)).toBe(1);
  });

  it('needsCompaction returns none under threshold', () => {
    const compactor = new ContextCompactor(config);
    const msgs: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a'.repeat(40) }] } // ~10 tokens
    ];
    expect(compactor.needsCompaction(msgs)).toBe('none');
  });

  it('needsCompaction returns warning at 50%', () => {
    const compactor = new ContextCompactor(config);
    const msgs: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a'.repeat(200) }] } // ~50 tokens
    ];
    expect(compactor.needsCompaction(msgs)).toBe('warning');
  });

  it('needsCompaction returns critical at 85%', () => {
    const compactor = new ContextCompactor(config);
    const msgs: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a'.repeat(350) }] } // ~87 tokens
    ];
    expect(compactor.needsCompaction(msgs)).toBe('critical');
  });

  it('compact preserves head and tail messages', async () => {
    const compactor = new ContextCompactor({
      ...config,
      protectedHeadCount: 2,
      protectedTailCount: 2
    });
    
    const msgs: Message[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: 'user', content: [{ type: 'text', text: `msg${i}` }] });
    }
    
    const compacted = await compactor.compact(msgs);
    
    expect(compacted.length).toBe(5); // 2 head + 1 summary + 2 tail
    expect((compacted[0].content[0] as any).text).toBe('msg0');
    expect((compacted[1].content[0] as any).text).toBe('msg1');
    expect((compacted[compacted.length - 2].content[0] as any).text).toBe('msg8');
    expect((compacted[compacted.length - 1].content[0] as any).text).toBe('msg9');
  });

  it('compact reduces total token count below budget', async () => {
    const compactor = new ContextCompactor(config);
    const msgs: Message[] = [];
    for (let i = 0; i < 100; i++) {
      msgs.push({ role: 'user', content: [{ type: 'text', text: 'a'.repeat(10) }] });
    }
    // Total tokens ~ 250, budget is 100
    
    const compacted = await compactor.compact(msgs);
    const newTokens = compactor.estimateTokens(compacted);
    
    // The summary might have some size, but it should be smaller
    expect(newTokens).toBeLessThan(100);
  });
  
  it('mechanical summary extracts tool names and text snippets', async () => {
    const compactor = new ContextCompactor(config);
    const msgs: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'head' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'this is a very long text'.repeat(10) }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: '1', name: 'myTool', input: { a: 1 } }] },
      { role: 'user', content: [{ type: 'text', text: 'tail' }] }
    ];
    
    const compacted = await compactor.compact(msgs);
    const summaryMsg = compacted[1];
    const text = (summaryMsg.content[0] as any).text;
    
    expect(text).toContain('this is a very long text');
    expect(text).toContain('myTool');
  });
});
