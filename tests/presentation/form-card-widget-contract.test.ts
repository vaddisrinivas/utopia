import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(root, 'src/presentation/widgets/panel-widget-family.tsx'), 'utf8');

describe('FormCardWidget presentation contract', () => {
  it('keeps public form copy separate from internal authoring language', () => {
    expect(source).toContain("subtitle: text(value.subtitle, 'Add the details you want to keep together.')");
    expect(source).toContain("text(props.body, text(props.cta, 'Review details'))");
    expect(source).not.toContain('Config-declared');
    expect(source).not.toContain('proposals/actions');
    expect(source).not.toContain('Preview action');
    expect(source).not.toContain('Preview ready');
  });

  it('does not expose raw field types and gives required fields useful feedback', () => {
    expect(source).toContain('function fieldDescription');
    expect(source).toContain('text(value.description, text(value.helpText))');
    expect(source).toContain('<Text style={styles.requiredLabel}>Required</Text>');
    expect(source).toContain("accessibilityHint={field.required === true ? 'Required field' : undefined}");
    expect(source).toContain('Add the required fields before continuing.');
    expect(source).toContain('Ready to continue.');
    expect(source).toContain('accessibilityLiveRegion="polite"');
  });

  it('supports focused inputs and a readable desktop two-column layout', () => {
    expect(source).toContain('useWindowDimensions');
    expect(source).toContain('const isWide = width >= 720');
    expect(source).toContain('styles.formFieldsWide');
    expect(source).toContain('styles.formFieldWide');
    expect(source).toContain('styles.formInputFocused');
    expect(source).toContain('onFocus={() => setFocusedField(key)}');
    expect(source).toContain('onBlur={() => setFocusedField(null)}');
    expect(source).toMatch(/formInput:\s*\{[\s\S]*?minHeight:\s*48/);
  });

  it('preserves package-provided form identity and labels', () => {
    expect(source).toContain('<WidgetShell title={props.title} subtitle={props.subtitle}>');
    expect(source).toContain('body: value.body');
    expect(source).toContain('cta: value.cta');
    expect(source).toContain('submitLabel: text(value.submitLabel)');
    expect(source).toContain('function formActionLabel');
  });

  it('persists explicitly bound forms while leaving unbound forms validation-only', () => {
    expect(source).toContain("import { upsertRecord } from '@/src/db/records';");
    expect(source).toContain("if (!props.collection) {");
    expect(source).toContain("await upsertRecord(db, runtime.activeManifest, {");
    expect(source).toContain("collection: props.collection,");
    expect(source).toContain("recordMode: text(value.recordMode) === 'append' ? 'append' : 'upsert'");
    expect(source).toContain("...resolveDynamicProperties(props.defaultProperties, now),");
    expect(source).toContain("coerceFieldValue(field, values[key] ?? '')");
    expect(source).toContain("setStatusMessage('Saved.');");
    expect(source).toContain("if (props.recordMode === 'append') setValues({});");
  });
});
