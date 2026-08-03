import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const homeSource = readFileSync(path.join(root, 'apps/scientific-calculator/source/screens/home.json'), 'utf8');
const functionsSource = readFileSync(path.join(root, 'apps/scientific-calculator/source/screens/functions.json'), 'utf8');
const historySource = readFileSync(path.join(root, 'apps/scientific-calculator/source/screens/history.json'), 'utf8');

describe('scientific workbench source copy', () => {
  it('removes invalid inline unit examples and names unsupported boundaries explicitly', () => {
    expect(homeSource).not.toContain('sin(45 deg)');
    expect(functionsSource).not.toContain('cos(60 deg)');
    expect(functionsSource).not.toContain('tan(45 deg)');
    expect(homeSource).toContain('Unit text such as cm, kg, or deg is not parsed inside expressions');
    expect(functionsSource).toContain('Type plain numbers only; convert units before entry');
    expect(functionsSource).toContain('No imaginary number support');
  });

  it('defines a manual saved-history editor instead of implying automatic capture', () => {
    expect(homeSource).toContain('History records are entered manually; evaluation does not auto-save');
    expect(historySource).toContain('"widget": "structuredList"');
    expect(historySource).toContain('"collection": "calculation"');
    expect(historySource).toContain('"field": "expression"');
    expect(historySource).toContain('"field": "result"');
    expect(historySource).toContain('"field": "mode"');
    expect(historySource).toContain('"widget": "operationHistory"');
  });
});
