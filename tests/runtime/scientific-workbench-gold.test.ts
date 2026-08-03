import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compileAppPackageSourceFolder } from '@/packages/app-compiler';
import type { AppPackage } from '@/packages/shared/contracts/package';
import { validateAppPackage } from '@/server/src/kernel/package';
import { evaluateScientificExpression, formatCalcValue } from '@/src/presentation/widgets/scientific-calculator-engine';

const root = process.cwd();
const packagePath = path.join(root, 'apps/scientific-calculator/scientific-calculator.v1.json');
const sourceRoot = path.join(root, 'apps/scientific-calculator/source');

describe('scientific workbench gold package', () => {
  it('validates the package and keeps a real saved-history workflow without fake save actions', () => {
    const appPackage = loadPackage();
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });

    const home = screenComponents(appPackage, 'home');
    const history = screenComponents(appPackage, 'history');
    const settings = screenComponents(appPackage, 'settings');

    expect(home.some((component) => component.kind === 'action')).toBe(false);
    expect(home.find((component) => component.kind === 'widget' && component.widget === 'scientificCalculator')).toBeDefined();
    expect(home.find((component) => component.id === 'calc-history-editor')).toMatchObject({
      kind: 'widget',
      widget: 'structuredList',
      props: expect.objectContaining({
        collection: 'calculation',
        editable: true,
        deletable: true,
        metadataFields: expect.arrayContaining([
          expect.objectContaining({ field: 'expression', required: true }),
          expect.objectContaining({ field: 'result', required: true }),
          expect.objectContaining({ field: 'mode', required: true }),
        ]),
      }),
    });
    expect(history.find((component) => component.id === 'calc-history-editor-full')).toMatchObject({
      kind: 'widget',
      widget: 'structuredList',
      props: expect.objectContaining({
        collection: 'calculation',
      }),
    });
    expect(history.find((component) => component.id === 'calc-operation-history')).toMatchObject({
      kind: 'widget',
      widget: 'operationHistory',
    });
    expect(JSON.stringify(settings)).toContain('equals does not auto-capture a row');
  });

  it('compiles the app-owned source screens and keeps the manual history editor in source too', () => {
    const compiled = compileAppPackageSourceFolder(sourceRoot);
    expect(compiled.valid).toBe(true);
    if (!compiled.valid) {
      throw new Error(compiled.errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
    }

    const home = compiled.package.presentation?.surfaces?.find((surface) => surface.id === 'home');
    const widgets = compiled.preview.widgets.slice().sort();

    expect(home?.label).toBe('Calculator');
    expect(widgets).toEqual(expect.arrayContaining([
      'dataTable',
      'operationHistory',
      'scientificCalculator',
      'structuredList',
    ]));
  });

  it('evaluates supported formulas and formats stable results', () => {
    expect(formatCalcValue(evaluateScientificExpression('1 + 2 * 3', { angleMode: 'deg', memory: 0 }))).toBe('7');
    expect(formatCalcValue(evaluateScientificExpression('sin(45)', { angleMode: 'deg', memory: 0 }))).toBe('0.707106781187');
    expect(formatCalcValue(evaluateScientificExpression('cos(pi / 4)', { angleMode: 'rad', memory: 0 }))).toBe('0.707106781187');
    expect(formatCalcValue(evaluateScientificExpression('ln(e ^ 3) + log10(1000)', { angleMode: 'deg', memory: 0 }))).toBe('6');
    expect(formatCalcValue(evaluateScientificExpression('5!', { angleMode: 'deg', memory: 0 }))).toBe('120');
    expect(formatCalcValue(evaluateScientificExpression('M + 2', { angleMode: 'deg', memory: 5 }))).toBe('7');
  });

  it('rejects unsupported or misleading input shapes that the package now names explicitly', () => {
    expect(() => evaluateScientificExpression('sin(45 deg)', { angleMode: 'deg', memory: 0 })).toThrow(/Missing \)|needs \(|Unexpected|Invalid/);
    expect(() => evaluateScientificExpression('12 cm', { angleMode: 'deg', memory: 0 })).toThrow(/Unexpected|Invalid/);
    expect(() => evaluateScientificExpression('sqrt(-1)', { angleMode: 'deg', memory: 0 })).toThrow('Result is not finite');
    expect(() => evaluateScientificExpression('1 / 0', { angleMode: 'deg', memory: 0 })).toThrow('Result is not finite');
    expect(() => evaluateScientificExpression('plot(2)', { angleMode: 'deg', memory: 0 })).toThrow('Unknown plot');
  });
});

function loadPackage(): AppPackage {
  return JSON.parse(readFileSync(packagePath, 'utf8')) as AppPackage;
}

function screenComponents(appPackage: AppPackage, screenId: string): Array<Record<string, any>> {
  const screens = appPackage.presentation?.ui?.screens;
  const screen = screens && typeof screens === 'object' ? (screens as Record<string, any>)[screenId] : null;
  return screen && Array.isArray(screen.components) ? screen.components : [];
}
