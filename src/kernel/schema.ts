import { z } from 'zod';
import { standardActionDefinitions, standardComponentDefinitions } from '@json-render/react-native/catalog';
import { supportedWidgetKinds } from './widget-support';

const Id = z.string().trim().min(1);
const Json = z.unknown();
const Dimension = z.union([z.number(), z.string()]);
export const jsonUiComponentKinds = Object.keys(standardComponentDefinitions) as [string, ...string[]];
export const jsonUiActionKinds = Object.keys(standardActionDefinitions) as [string, ...string[]];
const JsonUiComponentKind = z.enum(jsonUiComponentKinds);

export const JsonUiSpecSchema = z.object({
  root: Id,
  elements: z.record(z.string(), z.object({
    type: JsonUiComponentKind,
    props: z.record(z.string(), Json).default({}),
    children: z.array(z.string()).default([]),
    visible: Json.optional(),
  }).strict()),
}).strict().superRefine((spec, context) => {
  if (!spec.elements[spec.root]) context.addIssue({ code: 'custom', message: `unknown JSON UI root ${spec.root}` });
  for (const [id, element] of Object.entries(spec.elements)) {
    for (const child of element.children) {
      if (!spec.elements[child]) context.addIssue({ code: 'custom', message: `JSON UI element ${id} uses unknown child ${child}` });
    }
  }
});

export const LayoutSchema = z.object({
  display: z.enum(['flex', 'none']).optional(),
  direction: z.enum(['row', 'column', 'row-reverse', 'column-reverse']).optional(),
  wrap: z.enum(['wrap', 'nowrap', 'wrap-reverse']).optional(),
  justify: z.enum(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']).optional(),
  align: z.enum(['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline']).optional(),
  gap: z.number().nonnegative().optional(),
  padding: Dimension.optional(),
  paddingX: Dimension.optional(),
  paddingY: Dimension.optional(),
  margin: Dimension.optional(),
  marginX: Dimension.optional(),
  marginY: Dimension.optional(),
  width: Dimension.optional(),
  height: Dimension.optional(),
  minWidth: Dimension.optional(),
  minHeight: Dimension.optional(),
  maxWidth: Dimension.optional(),
  maxHeight: Dimension.optional(),
  aspectRatio: z.number().positive().optional(),
  radius: z.number().nonnegative().optional(),
  background: z.string().optional(),
  foreground: z.string().optional(),
  border: z.string().optional(),
  borderWidth: z.number().nonnegative().optional(),
  opacity: z.number().min(0).max(1).optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.enum(['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900']).optional(),
  lineHeight: z.number().positive().optional(),
  textAlign: z.enum(['auto', 'left', 'right', 'center', 'justify']).optional(),
}).strict();

export const ResponsiveSchema = z.object({
  base: LayoutSchema.optional(),
  compact: LayoutSchema.optional(),
  medium: LayoutSchema.optional(),
  wide: LayoutSchema.optional(),
  portrait: LayoutSchema.optional(),
  landscape: LayoutSchema.optional(),
  platform: z.object({
    web: LayoutSchema.optional(),
    android: LayoutSchema.optional(),
    ios: LayoutSchema.optional(),
    macos: LayoutSchema.optional(),
  }).optional(),
}).strict();

export const FieldSchema = z.object({
  type: z.enum(['text', 'number', 'boolean', 'timestamp', 'json']),
  required: z.boolean().optional(),
  indexed: z.boolean().optional(),
});

const WidgetKindSchema = z.enum(supportedWidgetKinds);

export const CollectionSchema = z.object({
  id: Id,
  fields: z.record(z.string(), FieldSchema),
});

export const QuerySchema = z.object({
  from: Id,
  where: Json.optional(),
  orderBy: z.array(z.object({ field: Id, direction: z.enum(['asc', 'desc']) })).optional(),
  limit: z.number().int().positive().optional(),
});

export const ComputedFieldSchema = z.object({
  id: Id,
  collection: Id,
  dependsOn: z.array(Id).default([]),
  expression: Json,
}).strict();

export const DataHomeSchema = z.object({
  id: Id,
  kind: z.enum(['sqlite', 'postgres', 'notion', 'google-sheets']),
  resource: z.string().optional(),
  secretRef: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  mode: z.enum(['local', 'pull', 'push', 'sync']).default('local'),
}).strict();

export const ActionSchema = z.object({
  kind: z.enum(['navigate', 'create', 'update', 'delete', 'toggle', 'undo', 'open_url', 'propose']),
  command: z.string().optional(),
  operation: z.enum(['navigate', 'create', 'update', 'archive', 'restore', 'retry', 'export', 'unsupported']).optional(),
  label: z.string().optional(),
  target: z.string().optional(),
  url: z.string().optional(),
  collection: z.string().optional(),
  recordId: z.string().optional(),
  values: z.record(z.string(), Json).optional(),
  payload: z.record(z.string(), Json).optional(),
}).passthrough().superRefine((action, context) => {
  if (action.kind === 'propose' && !action.operation) {
    context.addIssue({ code: 'custom', message: `proposed command ${action.command ?? '<unnamed>'} requires an operation` });
  }
  if (action.operation === 'unsupported') {
    context.addIssue({ code: 'custom', message: `unsupported command ${action.command ?? '<unnamed>'}` });
  }
});

export const ComponentSchema = z.object({
  kind: z.enum(['recordList', 'metric', 'action', 'text', 'widget']),
  id: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  tone: z.string().optional(),
  widget: WidgetKindSchema.optional(),
  view: z.string().optional(),
  layout: ResponsiveSchema.optional(),
  props: z.record(z.string(), Json).optional(),
  query: z.object({
    collections: z.array(z.string()).optional(),
    match: z.string().optional(),
    limit: z.number().int().positive().optional(),
  }).optional(),
  action: ActionSchema.optional(),
}).passthrough().superRefine((component, context) => {
  if (component.kind === 'widget' && !component.widget) {
    context.addIssue({ code: 'custom', message: 'widget kind requires widget key' });
  }
});

export const ScreenSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  layout: ResponsiveSchema.optional(),
  components: z.array(ComponentSchema).default([]),
});

export const PackageSchema = z.object({
  schemaVersion: z.literal('wonder.app-package.v3'),
  id: Id,
  version: Id,
  catalog: z.discriminatedUnion('status', [
    z.object({ status: z.literal('active') }).strict(),
    z.object({
      status: z.literal('inactive'),
      duplicateOf: Id,
      similarity: z.number().min(0.5).max(1),
      reason: z.literal('capability-overlap'),
    }).strict(),
  ]),
  collections: z.record(z.string(), CollectionSchema),
  queries: z.record(z.string(), QuerySchema),
  computedFields: z.array(ComputedFieldSchema).default([]),
  views: z.record(z.string(), z.object({
    id: Id,
    query: Id,
    mode: z.enum(['list', 'board', 'table', 'calendar', 'timeline', 'chart']),
    fields: z.array(z.string()),
  }).passthrough()),
  rules: z.array(Json),
  dataHomes: z.array(DataHomeSchema).default([{ id: 'local', kind: 'sqlite', mode: 'local' }]),
  defaultDataHome: Id.default('local'),
  capabilities: z.array(z.string()),
  acceptanceTests: z.array(z.string()),
  dependencyPins: z.array(z.object({
    package: Id,
    version: Id,
    source: z.enum(['npm', 'maven', 'gradle', 'cocoapods', 'other']).optional(),
  })),
  nativeCapabilities: z.object({
    schemaVersion: z.literal('wonder.app-package-native-capabilities.v1'),
    platform: z.enum(['expo', 'android', 'ios', 'web', 'macos']),
    packages: z.array(z.string()),
    permissions: z.array(Json).optional(),
    intents: z.array(Json).optional(),
  }).passthrough(),
  contractLock: z.object({
    schemaVersion: z.literal('wonder.package-contract-lock.v1'),
    algorithm: z.literal('sha256'),
    checksum: Id,
    pinnedAt: z.string().datetime(),
  }).passthrough(),
  presentation: z.object({
    label: Id,
    visualIdentity: z.object({
      icon: z.string().optional(),
      accent: z.string().optional(),
      canvas: z.string().optional(),
      tone: z.string().optional(),
    }).passthrough().optional(),
    ui: z.object({
      defaultScreen: z.string().optional(),
      layout: ResponsiveSchema.optional(),
      localization: z.object({
        defaultLocale: Id,
        fallbackLocale: Id.optional(),
        appLocale: Id.optional(),
        messages: z.record(z.string(), z.record(z.string(), z.string().min(1))),
      }).strict().optional(),
      navigation: z.object({ items: z.array(z.object({ screen: Id, label: Id, icon: z.string().optional() })) }).optional(),
      screens: z.record(z.string(), ScreenSchema),
    }).passthrough(),
  }).passthrough(),
}).passthrough().superRefine((pkg, context) => {
  if (pkg.catalog.status === 'inactive' && pkg.catalog.duplicateOf === pkg.id) {
    context.addIssue({ code: 'custom', message: 'package cannot duplicate itself' });
  }
  for (const [id, collection] of Object.entries(pkg.collections)) {
    if (id !== collection.id) context.addIssue({ code: 'custom', message: `collection id mismatch: ${id}` });
  }
  for (const [id, query] of Object.entries(pkg.queries)) {
    if (!pkg.collections[query.from]) context.addIssue({ code: 'custom', message: `query ${id} uses unknown collection ${query.from}` });
  }
  for (const field of pkg.computedFields) {
    if (!pkg.collections[field.collection]) context.addIssue({ code: 'custom', message: `computed field ${field.id} uses unknown collection ${field.collection}` });
  }
  for (const [id, view] of Object.entries(pkg.views)) {
    if (!pkg.queries[view.query]) context.addIssue({ code: 'custom', message: `view ${id} uses unknown query ${view.query}` });
  }
  const screens = pkg.presentation.ui.screens;
  const home = pkg.presentation.ui.defaultScreen;
  if (home && !screens[home]) context.addIssue({ code: 'custom', message: `unknown default screen ${home}` });
  if (!pkg.dataHomes.some((item) => item.id === pkg.defaultDataHome)) context.addIssue({ code: 'custom', message: `unknown data home ${pkg.defaultDataHome}` });
  for (const [screenId, screen] of Object.entries(screens)) {
    for (const component of screen.components) {
      if (component.widget === 'jsonUi' && !JsonUiSpecSchema.safeParse(component.props?.spec).success) {
        context.addIssue({ code: 'custom', message: `screen ${screenId} has invalid JSON UI spec` });
      }
    }
  }
});

export type AppPackage = z.infer<typeof PackageSchema>;
export type AppComponent = z.infer<typeof ComponentSchema>;
export type AppAction = z.infer<typeof ActionSchema>;

export function parsePackage(value: unknown): AppPackage {
  return PackageSchema.parse(value);
}
