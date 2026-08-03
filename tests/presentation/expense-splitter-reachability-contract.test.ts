import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'apps/expense-splitter/expense-splitter.v1.json'), 'utf8'));

describe('Expense Splitter settlement reachability', () => {
  it('gives each person an explicit key used by balance calculations', () => {
    expect(pkg.collections.person.fields.key).toMatchObject({ type: 'text', required: true, indexed: true });
    const personEditor = pkg.presentation.ui.screens.group.components.find((item: { id: string }) => item.id === 'person-editor');
    expect(personEditor.props).toMatchObject({ inputLabel: 'Person name', primaryActionLabel: 'Add person' });
    expect(personEditor.props.metadataFields).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'key', label: 'Person ID', required: true })]));
    const balanceFields = pkg.computedFields.filter((item: { id: string }) => item.id === 'paid_total' || item.id === 'owed_total');
    expect(balanceFields.every((item: any) => item.expression.group_sum.equals.var[0] === 'record.key')).toBe(true);
  });

  it('provides a real path to materialize the settlement projection', () => {
    expect(pkg.collections.settlement_summary.fields.settlements.required).not.toBe(true);
    const generator = pkg.presentation.ui.screens.settle.components.find((item: { id: string }) => item.id === 'settlement-summary-generator');
    expect(generator).toMatchObject({ widget: 'structuredList', props: { collection: 'settlement_summary', primaryActionLabel: 'Generate settlement' } });
    expect(pkg.presentation.ui.screens.settle.components.find((item: { id: string }) => item.id === 'settlement-transfer-table')).toBeTruthy();
  });
});
