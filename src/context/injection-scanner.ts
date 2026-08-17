export interface ScanThreat {
  line: number;
  content: string;
  threatType: 'instruction_override' | 'role_injection' | 'hidden_text' | 'encoded_payload';
  severity: 'low' | 'medium' | 'high';
}

export interface ScanResult {
  isSafe: boolean;
  threats: ScanThreat[];
}

export class InjectionScanner {
  public scan(content: string, source: string): ScanResult {
    const threats: ScanThreat[] = [];
    const lines = content.split('\n');

    const instructionOverrideRegex = /ignore previous instructions|you are now|forget everything|disregard|new instructions:|system:|IMPORTANT:\s*override/i;
    const roleInjectionRegex = /<\|system\|>|<\|assistant\|>|\[INST\]|### System:|Human:|Assistant:/i;
    const hiddenTextRegex = /[\u200B-\u200D\uFEFF]/;
    
    // Naive base64 check for long base64 strings that might decode to malicious content
    const base64Regex = /^(?:[A-Za-z0-9+/]{4}){25,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      if (instructionOverrideRegex.test(line)) {
        threats.push({
          line: lineNumber,
          content: line.trim(),
          threatType: 'instruction_override',
          severity: 'high'
        });
      }

      if (roleInjectionRegex.test(line)) {
        threats.push({
          line: lineNumber,
          content: line.trim(),
          threatType: 'role_injection',
          severity: 'medium'
        });
      }

      if (hiddenTextRegex.test(line)) {
        threats.push({
          line: lineNumber,
          content: line.trim(),
          threatType: 'hidden_text',
          severity: 'medium'
        });
      }
      
      const words = line.split(/\s+/);
      for (const word of words) {
          if (word.length >= 100 && base64Regex.test(word)) {
              try {
                  const decoded = Buffer.from(word, 'base64').toString('utf8');
                  if (instructionOverrideRegex.test(decoded) || roleInjectionRegex.test(decoded)) {
                       threats.push({
                          line: lineNumber,
                          content: word,
                          threatType: 'encoded_payload',
                          severity: 'high'
                       });
                  }
              } catch (e) {
                  // ignore
              }
          }
      }
    });

    return {
      isSafe: threats.length === 0,
      threats
    };
  }
}
