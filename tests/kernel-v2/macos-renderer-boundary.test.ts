import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../../macos/App.tsx'), 'utf8');

describe('macOS V3 renderer boundary', () => {
  it('has no generic unavailable placeholder text', () => {
    expect(source).not.toMatch(/Unavailable/);
  });

  it('routes components through shared generic adapters', () => {
    expect(source).toMatch(/from '..\/src\/kernel\/widgets'/);
    expect(source).toMatch(/from '..\/src\/kernel\/record-widgets'/);
    expect(source).toMatch(/<Widget /);
    expect(source).toMatch(/<RecordWidget /);
  });

  it('fails closed on unsupported component kinds', () => {
    expect(source).toMatch(/Unsupported component kind/);
  });

  it('does not include legacy macOS-local component renderers', () => {
    expect(source).not.toMatch(/function\s+(Calculator|Timer|Chat|Audio|Video|Weather|File|Media|Map|Chart|Route|Messaging|Canvas|Automation|Game|Checklist|Form)\s*\(/i);
  });
});
