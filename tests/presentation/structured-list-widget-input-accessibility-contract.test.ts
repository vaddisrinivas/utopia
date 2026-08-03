import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(root, 'src/presentation/widgets/structured-list-widget.tsx'), 'utf8');
const sourceFile = ts.createSourceFile('structured-list-widget.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);

function getTextInputElements(): ts.JsxSelfClosingElement[] {
  const inputs: ts.JsxSelfClosingElement[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'TextInput') {
      inputs.push(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return inputs;
}

function hasSharedInputStyle(node: ts.JsxSelfClosingElement): boolean {
  const styleAttribute = node.attributes.properties.find((property) => (
    ts.isJsxAttribute(property)
      && property.name.getText(sourceFile) === 'style'
      && property.initializer !== undefined
      && ts.isJsxExpression(property.initializer)
  )) as ts.JsxAttribute | undefined;

  if (!styleAttribute || !styleAttribute.initializer || !ts.isJsxExpression(styleAttribute.initializer)) return false;

  const expression = styleAttribute.initializer.expression;
  if (!expression) return false;

  if (ts.isPropertyAccessExpression(expression) && expression.getText(sourceFile) === 'styles.input') return true;

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some((element) => ts.isPropertyAccessExpression(element) && element.getText(sourceFile) === 'styles.input');
  }

  return false;
}

function hasInputMinHeightAtLeast44(): boolean {
  const stylesObject = sourceFile.statements.find((statement) => (
    ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((declaration) => declaration.name.getText(sourceFile) === 'styles')
  ));

  if (!stylesObject || !ts.isVariableStatement(stylesObject)) return false;

  let found = false;
  const walk = (node: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === 'input' && ts.isObjectLiteralExpression(node.initializer)) {
      const minHeight = node.initializer.properties.find((property) => ts.isPropertyAssignment(property)
        && property.name.getText(sourceFile) === 'minHeight'
        && ts.isNumericLiteral(property.initializer)
        && Number(property.initializer.text) >= 44);
      if (minHeight) found = true;
    }
    ts.forEachChild(node, walk);
  };

  walk(stylesObject);
  return found;
}

describe('structured-list input accessibility contract', () => {
  it('uses shared input style for all TextInput fields', () => {
    const inputNodes = getTextInputElements();
    expect(inputNodes.length, 'all TextInput nodes present').toBeGreaterThan(1);
    expect(inputNodes.every((node) => hasSharedInputStyle(node)), 'all text inputs use styles.input style').toBe(true);
  });

  it('enforces 44px+ touch target for text input style contract', () => {
    expect(hasInputMinHeightAtLeast44()).toBe(true);
  });
});
