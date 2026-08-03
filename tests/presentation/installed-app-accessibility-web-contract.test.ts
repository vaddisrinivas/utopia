import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(root, 'app/apps/[installationId].tsx'), 'utf8');
const sourceFile = ts.createSourceFile('installationId.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);

function findFunction(name: string): ts.FunctionDeclaration | undefined {
  return sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === name
    && !!statement.body
  ));
}

function isDocumentTitleEffect(statement: ts.Statement): statement is ts.ExpressionStatement {
  if (!ts.isExpressionStatement(statement)) return false;
  const expression = statement.expression;
  if (!ts.isCallExpression(expression)) return false;
  const callee = expression.expression;
  if (!ts.isIdentifier(callee) || callee.text !== 'useEffect') return false;

  const callback = expression.arguments[0];
  if (!callback || (!ts.isFunctionExpression(callback) && !ts.isArrowFunction(callback))) return false;

  let hasDocument = false;
  let hasLoading = false;
  let hasUnavailable = false;
  let hasSafeLabel = false;
  let hasOptionalLabel = false;

  const walk = (node: ts.Node): void => {
    if (hasDocument && hasLoading && hasUnavailable && hasSafeLabel && hasOptionalLabel) return;

    if (ts.isPropertyAccessExpression(node)
      && node.name.text === 'title'
      && node.expression.getText(sourceFile) === 'document') {
      hasDocument = true;
    }
    if (ts.isStringLiteral(node)) {
      hasLoading ||= node.text === 'Loading app — Utopia';
      hasUnavailable ||= node.text === 'App unavailable — Utopia';
    }
    if (ts.isIdentifier(node) && node.text === 'safeLabel') {
      hasSafeLabel = true;
    }
    if (ts.isPropertyAccessExpression(node)
      && node.name.text === 'label'
      && node.expression.getText(sourceFile) === 'installation') {
      hasOptionalLabel = true;
    }

    ts.forEachChild(node, walk);
  };

  walk(callback);
  return hasDocument && hasLoading && hasUnavailable && (hasSafeLabel || hasOptionalLabel);
}

function findIfIndex(statements: ts.NodeArray<ts.Statement>, predicate: (node: ts.IfStatement) => boolean): number {
  return statements.findIndex((statement): statement is ts.IfStatement => ts.isIfStatement(statement) && predicate(statement));
}

function hasMainAccessibilityRoleMain(): boolean {
  const fn = findFunction('mainAccessibilityRoleProps');
  if (!fn?.body) return false;
  let hasMain = false;
  let hasAccessible = false;
  const walk = (node: ts.Node): void => {
    if (hasMain && hasAccessible) return;
    if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === 'accessibilityRole') {
      const initializer = node.initializer;
      if (ts.isAsExpression(initializer) && ts.isStringLiteral(initializer.expression) && initializer.expression.text === 'main') {
        hasMain = true;
      }
    }
    if (ts.isPropertyAssignment(node)
      && node.name.getText(sourceFile) === 'accessible'
      && node.initializer.getText(sourceFile) === 'true') {
      hasAccessible = true;
    }
    ts.forEachChild(node, walk);
  };
  walk(fn);
  return hasMain && hasAccessible;
}

function hasHeaderSemanticText(fn?: ts.FunctionDeclaration): boolean {
  if (!fn || !fn.body) return false;
  let hasHeader = false;
  const walk = (node: ts.Node): void => {
    if (hasHeader) return;
    if (ts.isJsxElement(node)) {
      const tagName = node.openingElement.tagName.getText(sourceFile);
      const role = node.openingElement.attributes.properties.find((property) => ts.isJsxAttribute(property)
        && property.name.getText(sourceFile) === 'accessibilityRole'
        && property.initializer !== undefined
        && ts.isStringLiteral(property.initializer)
        && property.initializer.text === 'header');
      const accessible = node.openingElement.attributes.properties.find((property) => ts.isJsxAttribute(property)
        && property.name.getText(sourceFile) === 'accessible'
        && (property.initializer === undefined || property.initializer.getText(sourceFile) === 'true'));
      if (tagName === 'Text' && role && accessible) {
        hasHeader = true;
        return;
      }
    }
    if (ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      const role = node.attributes.properties.find((property) => ts.isJsxAttribute(property)
        && property.name.getText(sourceFile) === 'accessibilityRole'
        && property.initializer !== undefined
        && ts.isStringLiteral(property.initializer)
        && property.initializer.text === 'header');
      const accessible = node.attributes.properties.find((property) => ts.isJsxAttribute(property)
        && property.name.getText(sourceFile) === 'accessible'
        && (property.initializer === undefined || property.initializer.getText(sourceFile) === 'true'));
      if (tagName === 'Text' && role && accessible) hasHeader = true;
    }
    ts.forEachChild(node, walk);
  };
  walk(fn);
  return hasHeader;
}

describe('installed app accessibility and web title behavior', () => {
  it('sets web document title before installed-app route guards with safe label sourcing', () => {
    const route = findFunction('InstalledAppRoute');
    expect(route?.body, 'InstalledAppRoute exists').toBeDefined();
    const statements = route!.body!.statements;

    const effectIndex = statements.findIndex(isDocumentTitleEffect);
    const loadingIndex = findIfIndex(statements, (statement) => statement.expression.getText(sourceFile) === 'loading');
    const missingIndex = findIfIndex(
      statements,
      (statement) => statement.expression.getText(sourceFile).includes('!db || !installationId || !installation'),
    );

    expect(effectIndex, 'installed-app route title effect exists').toBeGreaterThan(-1);
    expect(loadingIndex, 'route loading guard exists').toBeGreaterThan(-1);
    expect(missingIndex, 'route missing-installation guard exists').toBeGreaterThan(-1);
    expect(effectIndex, 'title effect must run before loading guard').toBeLessThan(loadingIndex);
    expect(effectIndex, 'title effect must run before missing-installation guard').toBeLessThan(missingIndex);
    expect(source).toContain('installation?.label ??');
  });

  it('renders semantic web landmarks from RN accessibility props', () => {
    expect(hasMainAccessibilityRoleMain()).toBe(true);
    expect(hasHeaderSemanticText(findFunction('ScreenHeading'))).toBe(true);
    expect(source).toContain("createElement('h1'");
  });
});
