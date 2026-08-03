import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import invoiceReviewPackage from '@/apps/invoice-review/invoice-review.v1.json';
import { compileAppPackageSourceFolder } from '@/packages/app-compiler';
import { APP_PACKAGE_WIDGET_KINDS } from '@/packages/shared/contracts/ui-widgets';
import { validateAppPackage } from '@/server/src/kernel/package';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.join(root, 'apps/food/package-source');
const widgetSource = readFileSync(path.join(root, 'src/presentation/widgets/record-review-card-widget.tsx'), 'utf8');

function components(appPackage: Record<string, any>) {
  return Object.values(appPackage.presentation.ui.screens as Record<string, { components: Array<Record<string, any>> }>)
    .flatMap((screen) => screen.components)
    .filter((component) => component.kind === 'widget');
}

describe('record review card primitive', () => {
  it('has neutral contract vocabulary and no Food-specific defaults', () => {
    expect(widgetSource).toContain('RecordReviewCardProps');
    expect(widgetSource).toContain('props.items');
    expect(widgetSource).toContain('props.actions');
    expect(widgetSource).not.toMatch(/receipt|food|meal|pantry|kitchen/i);
  });

  it.each([
    ['Food', () => {
      const compiled = compileAppPackageSourceFolder(sourceRoot);
      if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));
      return compiled.package;
    }],
    ['Invoice Review', () => invoiceReviewPackage],
  ] as const)('%s uses the shared primitive with data and actions', (_name, packageFactory) => {
    const appPackage = packageFactory();
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(APP_PACKAGE_WIDGET_KINDS).toContain('recordReviewCard');
    const review = components(appPackage).find((component) => component.widget === 'recordReviewCard');
    expect(review).toBeDefined();
    expect(Array.isArray(review?.props?.items)).toBe(true);
    expect(Array.isArray(review?.props?.actions)).toBe(true);
  });

  it('preserves Food review rows, badge, and routed actions', () => {
    const compiled = compileAppPackageSourceFolder(sourceRoot);
    if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));
    const review = components(compiled.package).find((component) => component.widget === 'recordReviewCard');
    expect(review?.id).toBe('food-shop-receipt-review');
    expect(review?.props?.badge).toBe('Review required');
    expect(review?.props?.items).toHaveLength(3);
    expect(review?.props?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Review receipt', route: '/capture?mode=receipt' }),
      expect.objectContaining({ title: 'Open purchases', route: '/collection/purchase,purchase_line?title=Purchases' }),
    ]));
  });
});
