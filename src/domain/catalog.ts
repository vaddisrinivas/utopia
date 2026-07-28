import catalogJson from '../../packages/domain-config/domain-catalog.v1.json';
import foodManifestJson from '../../packages/domain-config/domains/food.v1.json';
import healthManifestJson from '../../packages/domain-config/domains/health.v1.json';
import plantsManifestJson from '../../packages/domain-config/domains/plants.v1.json';
import type { AppPackage, AppPackageDependencyPin, AppPackageNativeCapability, A2UiSurface, A2UiComponent } from '../../packages/shared/contracts/package';
import { isAppPackageNativeIntentKind } from '../../packages/shared/contracts/native-capability-kinds';
import { isAppPackageUiActionKind, isAppPackageUiComponentKind, isAppPackageUiTone } from '../../packages/shared/contracts/ui-primitives';
import { isAppPackageWidgetKind } from '../../packages/shared/contracts/ui-widgets';

type ParsedUiScreen = {
  title?: string;
  subtitle?: string;
  components?: A2UiComponent[];
};

export type CatalogSchemaVersion = 'utopia.domain-catalog.v1';
export type DomainSchemaVersion = 'utopia.domain.v1';
export type DomainStatus = 'active' | 'ready' | 'preview' | 'disabled';

export type DomainId = string;
export type CollectionId = string;

export type Surface = {
  id: string;
  label: string;
  icon?: string;
  image_url?: string;
  views?: string[];
  collections: string[];
};

export type VisualToken = {
  icon?: string;
  emoji?: string;
  image_url?: string;
  accent?: 'neutral' | 'moss' | 'amber' | 'plum' | 'blue';
};

export type DomainVisualIdentity = {
  domain?: VisualToken;
  surfaces?: Record<string, VisualToken>;
  collections?: Record<string, VisualToken>;
  statuses?: Record<string, VisualToken>;
  actions?: Record<string, VisualToken>;
  sources?: Record<string, VisualToken>;
  skills?: Record<string, VisualToken>;
  agents?: Record<string, VisualToken>;
};

export type DomainRenderIntent = {
  terms?: string[];
  title?: string;
  intro?: string;
  columns?: string[];
  fields?: string[];
  boost_collections?: string[];
};

export type DomainRenderContract = {
  answer_label?: string;
  empty_intro?: string;
  default_title?: string;
  default_intro?: string;
  default_columns?: string[];
  default_fields?: string[];
  card_bullets?: string[];
  source_quote_fields?: string[];
  source_exclude_fields?: string[];
  intents?: Record<string, DomainRenderIntent>;
};

export type ManifestRelation = {
  from: string;
  to: string;
  name: string;
};

export interface DomainManifest {
  schema_version: DomainSchemaVersion;
  id: DomainId;
  label: string;
  home_surface?: string;
  surfaces: Surface[];
  collections: CollectionId[];
  visual_identity?: DomainVisualIdentity;
  relations: ManifestRelation[];
  skills: string[];
  workflows: string[];
  data_homes: string[];
  dependency_pins?: AppPackageDependencyPin[];
  native_capabilities?: AppPackageNativeCapability;
  ui?: A2UiSurface;
  render?: DomainRenderContract;
  rich_detail_schema?: string;
  provider_template_fields?: {
    required?: string[];
    rich_detail_json?: string[];
    relations_json?: string[];
  };
  mcp: {
    resources: string[];
    tools: string[];
  };
}

export interface DomainCatalogEntry {
  id: DomainId;
  label: string;
  icon: string;
  status: DomainStatus;
  manifest: string;
  skill: string;
  summary: string;
}

export interface DomainCatalog {
  schema_version: CatalogSchemaVersion;
  shell_version: string;
  active_domain_id: DomainId;
  shell: {
    tabs: string[];
    global_actions: string[];
    action_policy: string;
  };
  domains: DomainCatalogEntry[];
}

export interface ParsedCatalog {
  catalog: DomainCatalog;
  activeDomainId: DomainId;
  activeDomain?: DomainCatalogEntry;
  activeManifest: DomainManifest;
  domainsById: Record<DomainId, DomainCatalogEntry>;
}

export type CatalogLoadOptions = {
  activeDomainId?: string | null;
  activePackage?: AppPackage | null;
};

let parsedCatalogCache: ParsedCatalog | null = null;
let activeDomainOverride: string | null = null;
let activePackageOverride: AppPackage | null = null;

export function setActiveDomainOverride(domainId: string | null): void {
  const next = domainId?.trim() || null;
  if (activeDomainOverride === next) {
    return;
  }
  activeDomainOverride = next;
  parsedCatalogCache = null;
}

export function setActivePackageOverride(pkg: AppPackage | null): void {
  activePackageOverride = pkg;
  parsedCatalogCache = null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[domain-catalog] ${message}`);
  }
}

function parseString(value: unknown, path: string): string {
  assertCondition(typeof value === 'string' && value.trim().length > 0, `Expected non-empty string at ${path}`);
  return value as string;
}

function parseStringArray(value: unknown, path: string): string[] {
  assertCondition(Array.isArray(value), `Expected array at ${path}`);
  const values = value as unknown[];
  for (const [index, item] of values.entries()) {
    assertCondition(typeof item === 'string', `Expected string item at ${path}[${index}]`);
  }
  return values as string[];
}

function parseObjectArray(value: unknown, path: string): Record<string, unknown>[] {
  assertCondition(Array.isArray(value), `Expected array at ${path}`);
  const values = value as unknown[];
  for (const [index, item] of values.entries()) {
    assertCondition(isObject(item), `Expected object at ${path}[${index}]`);
  }
  return values as Record<string, unknown>[];
}

function parseOptionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  return parseStringArray(value, path);
}

function parseVisualToken(value: unknown): VisualToken | undefined {
  if (!isObject(value)) return undefined;
  const token = value as Record<string, unknown>;
  const accent = token.accent;
  return {
    icon: typeof token.icon === 'string' ? token.icon : undefined,
    emoji: typeof token.emoji === 'string' ? token.emoji : undefined,
    image_url: typeof token.image_url === 'string' ? token.image_url : undefined,
    accent: accent === 'neutral' || accent === 'moss' || accent === 'amber' || accent === 'plum' || accent === 'blue' ? accent : undefined,
  };
}

function parseVisualTokenMap(value: unknown): Record<string, VisualToken> | undefined {
  if (!isObject(value)) return undefined;
  const parsed: Record<string, VisualToken> = {};
  for (const [key, token] of Object.entries(value)) {
    const visual = parseVisualToken(token);
    if (visual) parsed[key] = visual;
  }
  return parsed;
}

function parseVisualIdentity(value: unknown): DomainVisualIdentity | undefined {
  if (!isObject(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return {
    domain: parseVisualToken(raw.domain),
    surfaces: parseVisualTokenMap(raw.surfaces),
    collections: parseVisualTokenMap(raw.collections),
    statuses: parseVisualTokenMap(raw.statuses),
    actions: parseVisualTokenMap(raw.actions),
    sources: parseVisualTokenMap(raw.sources),
    skills: parseVisualTokenMap(raw.skills),
    agents: parseVisualTokenMap(raw.agents),
  };
}

function parseRenderContract(value: unknown): DomainRenderContract | undefined {
  if (!isObject(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const intents: Record<string, DomainRenderIntent> = {};
  if (isObject(raw.intents)) {
    for (const [key, intent] of Object.entries(raw.intents)) {
      if (!isObject(intent)) continue;
      const item = intent as Record<string, unknown>;
      intents[key] = {
        terms: Array.isArray(item.terms) ? (item.terms as string[]) : undefined,
        title: typeof item.title === 'string' ? item.title : undefined,
        intro: typeof item.intro === 'string' ? item.intro : undefined,
        columns: Array.isArray(item.columns) ? (item.columns as string[]) : undefined,
        fields: Array.isArray(item.fields) ? (item.fields as string[]) : undefined,
        boost_collections: Array.isArray(item.boost_collections) ? (item.boost_collections as string[]) : undefined,
      };
    }
  }
  return {
    answer_label: typeof raw.answer_label === 'string' ? raw.answer_label : undefined,
    empty_intro: typeof raw.empty_intro === 'string' ? raw.empty_intro : undefined,
    default_title: typeof raw.default_title === 'string' ? raw.default_title : undefined,
    default_intro: typeof raw.default_intro === 'string' ? raw.default_intro : undefined,
    default_columns: Array.isArray(raw.default_columns) ? (raw.default_columns as string[]) : undefined,
    default_fields: Array.isArray(raw.default_fields) ? (raw.default_fields as string[]) : undefined,
    card_bullets: Array.isArray(raw.card_bullets) ? (raw.card_bullets as string[]) : undefined,
    source_quote_fields: Array.isArray(raw.source_quote_fields) ? (raw.source_quote_fields as string[]) : undefined,
    source_exclude_fields: Array.isArray(raw.source_exclude_fields) ? (raw.source_exclude_fields as string[]) : undefined,
    intents: Object.keys(intents).length ? intents : undefined,
  };
}

function parseNativeCapability(value: unknown, path: string): AppPackageNativeCapability | undefined {
  if (value === undefined) return undefined;
  assertCondition(isObject(value), `${path} must be an object`);
  const raw = value as Record<string, unknown>;
  assertCondition(raw.schemaVersion === 'wonder.app-package-native-capabilities.v1', `${path}.schemaVersion must be wonder.app-package-native-capabilities.v1`);
  assertCondition(raw.platform === 'expo' || raw.platform === 'android' || raw.platform === 'ios' || raw.platform === 'web', `${path}.platform must be expo|android|ios|web`);
  const packages = parseStringArray(raw.packages, `${path}.packages`);
  assertCondition(packages.length > 0, `${path}.packages must not be empty`);
  const permissions = raw.permissions === undefined
    ? undefined
    : parseNativePermissions(raw.permissions, `${path}.permissions`);
  const intents = raw.intents === undefined
    ? undefined
    : parseNativeIntents(raw.intents, `${path}.intents`);
  return {
    schemaVersion: 'wonder.app-package-native-capabilities.v1',
    platform: raw.platform,
    packages,
    ...(permissions ? { permissions } : {}),
    ...(intents ? { intents } : {}),
  };
}

function parseDependencyPins(value: unknown, path: string): AppPackageDependencyPin[] | undefined {
  if (value === undefined) return undefined;
  assertCondition(Array.isArray(value), `${path} must be an array`);
  return value.map((item, index) => {
    assertCondition(isObject(item), `${path}[${index}] must be an object`);
    const raw = item as Record<string, unknown>;
    const source = raw.source;
    if (source !== undefined) {
      assertCondition(source === 'npm' || source === 'maven' || source === 'gradle' || source === 'cocoapods' || source === 'other', `${path}[${index}].source is invalid`);
    }
    return {
      package: parseString(raw.package, `${path}[${index}].package`),
      version: parseString(raw.version, `${path}[${index}].version`),
      ...(source ? { source } : {}),
    };
  });
}

function parseNativePermissions(value: unknown, path: string): AppPackageNativeCapability['permissions'] {
  assertCondition(Array.isArray(value), `${path} must be an array`);
  return value.map((item, index) => {
    if (typeof item === 'string') {
      assertCondition(item.trim().length > 0, `${path}[${index}] must not be empty`);
      return item;
    }
    assertCondition(isObject(item), `${path}[${index}] must be a string or object`);
    const raw = item as Record<string, unknown>;
    const platform = raw.platform;
    assertCondition(platform === 'expo' || platform === 'android' || platform === 'ios' || platform === 'web', `${path}[${index}].platform must be expo|android|ios|web`);
    if (raw.required !== undefined) {
      assertCondition(typeof raw.required === 'boolean', `${path}[${index}].required must be boolean`);
    }
    if (raw.prompt !== undefined) {
      assertCondition(typeof raw.prompt === 'string' && raw.prompt.trim().length > 0, `${path}[${index}].prompt must be a non-empty string`);
    }
    return {
      id: parseString(raw.id, `${path}[${index}].id`),
      platform,
      permission: parseString(raw.permission, `${path}[${index}].permission`),
      reason: parseString(raw.reason, `${path}[${index}].reason`),
      ...(raw.required === undefined ? {} : { required: raw.required }),
      ...(typeof raw.prompt === 'string' ? { prompt: raw.prompt } : {}),
    };
  });
}

function parseNativeIntents(value: unknown, path: string): AppPackageNativeCapability['intents'] {
  assertCondition(Array.isArray(value), `${path} must be an array`);
  return value.map((item, index) => {
    assertCondition(isObject(item), `${path}[${index}] must be an object`);
    const raw = item as Record<string, unknown>;
    const platform = raw.platform;
    assertCondition(platform === 'expo' || platform === 'android' || platform === 'ios' || platform === 'web', `${path}[${index}].platform must be expo|android|ios|web`);
    const kind = raw.kind;
    assertCondition(
      isAppPackageNativeIntentKind(kind),
      `${path}[${index}].kind is invalid`,
    );
    if (raw.required !== undefined) {
      assertCondition(typeof raw.required === 'boolean', `${path}[${index}].required must be boolean`);
    }
    if (raw.payload !== undefined) {
      assertCondition(isObject(raw.payload), `${path}[${index}].payload must be an object`);
    }
    return {
      id: parseString(raw.id, `${path}[${index}].id`),
      platform,
      kind,
      reason: parseString(raw.reason, `${path}[${index}].reason`),
      ...(raw.required === undefined ? {} : { required: raw.required }),
      ...(isObject(raw.payload) ? { payload: raw.payload } : {}),
    };
  });
}

function parseUiValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(parseUiValue).filter((child) => child !== undefined);
  }
  if (!isObject(value)) return value === undefined ? undefined : value;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, child]) => [key, parseUiValue(child)])
      .filter(([, child]) => child !== undefined),
  );
}

function parseUiAction(value: unknown, path: string): unknown {
  if (!isObject(value)) {
    throw new Error(`${path} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  if (!isAppPackageUiActionKind(raw.kind)) {
    throw new Error(`${path}.kind must be open_url|propose`);
  }
  if (raw.kind === 'open_url') {
    assertCondition(typeof raw.url === 'string' && raw.url.trim().length > 0, `Expected url at ${path}.url`);
  } else {
    assertCondition(typeof raw.command === 'string' && raw.command.trim().length > 0 || typeof raw.tool === 'string' && raw.tool.trim().length > 0,
      `Expected command or tool at ${path}`);
  }
  return parseUiValue(raw);
}

function parseUiComponent(value: unknown, path: string, packageCollections: Set<string>): A2UiComponent {
  if (!isObject(value)) {
    throw new Error(`${path} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const kind = raw.kind;
  assertCondition(isAppPackageUiComponentKind(kind), `${path}.kind must be recordList|metric|action|text|widget`);
  if (kind === 'action') {
    assertCondition(typeof raw.id === 'string' && raw.id.trim().length > 0, `${path}.id required for action components`);
  }
  if (kind === 'widget') {
    assertCondition(
      isAppPackageWidgetKind(raw.widget),
      `${path}.widget must be a supported A2UI widget`,
    );
    if (raw.props !== undefined) {
      assertCondition(isObject(raw.props), `${path}.props must be an object`);
    }
  }
  if (raw.tone !== undefined && !isAppPackageUiTone(raw.tone)) {
    throw new Error(`${path}.tone must be neutral|moss|amber|plum|blue`);
  }
  if (raw.placement !== undefined && !['inline', 'top', 'fab'].includes(String(raw.placement))) {
    throw new Error(`${path}.placement must be inline|top|fab`);
  }
  if (raw.placement !== undefined && kind !== 'action') {
    throw new Error(`${path}.placement is only valid for action components`);
  }
  if (raw.action !== undefined) {
    parseUiAction(raw.action, `${path}.action`);
  }
  if (raw.query !== undefined) {
    assertCondition(isObject(raw.query), `${path}.query must be an object`);
    const q = raw.query as Record<string, unknown>;
    const collections = parseOptionalStringArray(q.collections, `${path}.query.collections`) ?? [];
    for (const collection of collections) {
      assertCondition(packageCollections.has(collection), `${path}.query.collections references missing collection ${collection}`);
    }
    if (q.match !== undefined) {
      assertCondition(typeof q.match === 'string', `${path}.query.match must be a string`);
      const match = q.match;
      if (match.trim()) {
        try {
          new RegExp(match, 'i');
        } catch {
          throw new Error(`${path}.query.match is invalid regular expression`);
        }
      }
    }
    if (q.limit !== undefined) {
      assertCondition(typeof q.limit === 'number' && Number.isInteger(q.limit) && q.limit >= 1 && q.limit <= 200, `${path}.query.limit must be 1..200`);
    }
  }
  return parseUiValue(raw) as A2UiComponent;
}

function parseUiScreen(value: unknown, path: string, packageCollections: Set<string>): ParsedUiScreen {
  if (!isObject(value)) {
    throw new Error(`${path} must be an object`);
  }
  const screen = value as Record<string, unknown>;
  if (screen.components === undefined) {
    return parseUiValue(screen) as ParsedUiScreen;
  }

  const components = screen.components;
  if (!Array.isArray(components)) {
    throw new Error(`${path}.components must be an array`);
  }
  const parsedScreen: ParsedUiScreen = {
    ...(parseUiValue(screen) as ParsedUiScreen),
    components: components.map((component, index) => parseUiComponent(component, `${path}.components[${index}]`, packageCollections)),
  };
  return parsedScreen;
}

function parseUiScreens(value: unknown, path: string, packageCollections: Set<string>): Record<string, ParsedUiScreen> {
  const screens: Record<string, ParsedUiScreen> = {};
  if (!isObject(value)) {
    throw new Error(`${path} must be an object`);
  }
  for (const [screenId, screen] of Object.entries(value)) {
    const parsedScreen = parseUiScreen(screen, `${path}.${screenId}`, packageCollections);
    screens[screenId] = parsedScreen;
  }
  return screens;
}

function parseUi(value: unknown, path: string, packageCollections: Set<string>): A2UiSurface | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    throw new Error(`${path} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const parsed: A2UiSurface = {
    schemaVersion: raw.schemaVersion === 'a2ui.v0_9' ? 'a2ui.v0_9' : undefined,
    openUrlAllowlist: raw.openUrlAllowlist === undefined ? undefined : parseOptionalStringArray(raw.openUrlAllowlist, `${path}.openUrlAllowlist`),
    navigation: undefined,
    components: undefined,
    screens: undefined,
    defaultScreen: raw.defaultScreen === undefined ? undefined : parseString(raw.defaultScreen, `${path}.defaultScreen`),
  };
  if (raw.navigation !== undefined) {
    assertCondition(isObject(raw.navigation), `${path}.navigation must be an object`);
    const items = (raw.navigation as Record<string, unknown>).items;
    assertCondition(Array.isArray(items) && items.length >= 1 && items.length <= 5, `${path}.navigation.items must contain 1..5 items`);
    const seen = new Set<string>();
    parsed.navigation = {
      items: items.map((item, index) => {
        assertCondition(isObject(item), `${path}.navigation.items[${index}] must be an object`);
        const screen = parseString(item.screen, `${path}.navigation.items[${index}].screen`);
        assertCondition(['home', 'overview', 'chat', 'sources', 'settings'].includes(screen), `${path}.navigation.items[${index}].screen is invalid`);
        assertCondition(!seen.has(screen), `${path}.navigation.items contains duplicate ${screen}`);
        seen.add(screen);
        const icon = item.icon === undefined ? undefined : parseString(item.icon, `${path}.navigation.items[${index}].icon`);
        assertCondition(icon === undefined || ['home', 'food', 'sparkles', 'sync', 'settings'].includes(icon), `${path}.navigation.items[${index}].icon is invalid`);
        return {
          screen: screen as 'home' | 'overview' | 'chat' | 'sources' | 'settings',
          label: parseString(item.label, `${path}.navigation.items[${index}].label`),
          icon: icon as 'home' | 'food' | 'sparkles' | 'sync' | 'settings' | undefined,
        };
      }),
    };
  }

  if (raw.components !== undefined) {
    const components = raw.components;
    if (!Array.isArray(components)) {
      throw new Error(`${path}.components must be an array`);
    }
    if (components.length === 0) {
      throw new Error(`${path}.components must not be empty`);
    }
    parsed.components = components.map((component, index) => {
      parseUiComponent(component, `${path}.components[${index}]`, packageCollections);
      return parseUiValue(component) as A2UiComponent;
    });
  }

  if (raw.screens !== undefined) {
    const screens = parseUiScreens(raw.screens, `${path}.screens`, packageCollections);
    parsed.screens = screens;
  }

  if (!parsed.components && !parsed.screens) {
    throw new Error(`${path} requires components or screens`);
  }
  if (parsed.screens) {
    const screenIds = Object.keys(parsed.screens);
    assertCondition(screenIds.length > 0, `${path}.screens must not be empty`);
    assertCondition(parsed.defaultScreen === undefined || screenIds.includes(parsed.defaultScreen), `${path}.defaultScreen references missing screen ${String(parsed.defaultScreen)}`);
  }
  return parsed;
}

function parseDomainManifest(value: unknown, path: string): DomainManifest {
  assertCondition(isObject(value), `Expected object at ${path}`);
  const raw = value as Record<string, unknown>;
  assertCondition(raw.schema_version === 'utopia.domain.v1', `Invalid schema_version at ${path}`);

  const surfaces = parseObjectArray(raw.surfaces, `${path}.surfaces`);
  const parsedSurfaces = surfaces.map((surface, index) => {
    assertCondition(isObject(surface), `Expected object at ${path}.surfaces[${index}]`);
    const s = surface as Record<string, unknown>;
    return {
      id: parseString(s.id, `${path}.surfaces[${index}].id`),
      label: parseString(s.label, `${path}.surfaces[${index}].label`),
      icon: typeof s.icon === 'string' ? s.icon : undefined,
      image_url: typeof s.image_url === 'string' ? s.image_url : undefined,
      views: Array.isArray(s.views) ? (s.views as string[]) : undefined,
      collections: parseStringArray(s.collections, `${path}.surfaces[${index}].collections`),
    };
  });

  const relations = parseObjectArray(raw.relations, `${path}.relations`);
  const parsedRelations = relations.map((relation, index) => {
    assertCondition(isObject(relation), `Expected object at ${path}.relations[${index}]`);
    const rel = relation as Record<string, unknown>;
    return {
      from: parseString(rel.from, `${path}.relations[${index}].from`),
      to: parseString(rel.to, `${path}.relations[${index}].to`),
      name: parseString(rel.name, `${path}.relations[${index}].name`),
    };
  });

  const mcp = raw.mcp as Record<string, unknown>;
  assertCondition(isObject(mcp), `Expected mcp object at ${path}.mcp`);
  const providerTemplateFields = raw.provider_template_fields;
  const parsedProviderTemplateFields = isObject(providerTemplateFields) ? {
    required: Array.isArray(providerTemplateFields.required) ? (providerTemplateFields.required as string[]) : undefined,
    rich_detail_json: Array.isArray(providerTemplateFields.rich_detail_json) ? (providerTemplateFields.rich_detail_json as string[]) : undefined,
    relations_json: Array.isArray(providerTemplateFields.relations_json) ? (providerTemplateFields.relations_json as string[]) : undefined,
  } : undefined;
  const collections = parseStringArray(raw.collections, `${path}.collections`);
  const collectionSet = new Set(collections);
  const ui = parseUi(raw.ui, `${path}.ui`, collectionSet);

  return {
    schema_version: 'utopia.domain.v1',
    id: parseString(raw.id, `${path}.id`),
    label: parseString(raw.label, `${path}.label`),
    home_surface: typeof raw.home_surface === 'string' ? raw.home_surface : undefined,
    surfaces: parsedSurfaces,
    collections,
    visual_identity: parseVisualIdentity(raw.visual_identity),
    relations: parsedRelations,
    skills: parseStringArray(raw.skills, `${path}.skills`),
    workflows: parseStringArray(raw.workflows, `${path}.workflows`),
    data_homes: parseStringArray(raw.data_homes, `${path}.data_homes`),
    dependency_pins: parseDependencyPins(raw.dependency_pins, `${path}.dependency_pins`),
    native_capabilities: parseNativeCapability(raw.native_capabilities, `${path}.native_capabilities`),
    ui,
    render: parseRenderContract(raw.render),
    rich_detail_schema: typeof raw.rich_detail_schema === 'string' ? raw.rich_detail_schema : undefined,
    provider_template_fields: parsedProviderTemplateFields,
    mcp: {
      resources: parseStringArray(mcp.resources, `${path}.mcp.resources`),
      tools: parseStringArray(mcp.tools, `${path}.mcp.tools`),
    },
  };
}

function parseCatalog(value: unknown): DomainCatalog {
  assertCondition(isObject(value), 'Expected object for catalog root');
  const raw = value as Record<string, unknown>;
  assertCondition(raw.schema_version === 'utopia.domain-catalog.v1', 'Invalid catalog schema version');
  const shell = raw.shell as Record<string, unknown> | undefined;
  if (!isObject(shell)) {
    throw new Error('[domain-catalog] Expected shell object');
  }
  const domainsRaw = parseObjectArray(raw.domains, 'catalog.domains');

  const domains: DomainCatalogEntry[] = domainsRaw.map((domain, index) => {
    assertCondition(isObject(domain), `Expected object at catalog.domains[${index}]`);
    const entry = domain as Record<string, unknown>;
    assertCondition(typeof entry.id === 'string' && entry.id.length > 0, `Invalid id at catalog.domains[${index}]`);
    assertCondition(typeof entry.label === 'string' && entry.label.length > 0, `Invalid label at catalog.domains[${index}]`);
    assertCondition(typeof entry.icon === 'string' && entry.icon.length > 0, `Invalid icon at catalog.domains[${index}]`);
    assertCondition(typeof entry.status === 'string', `Invalid status at catalog.domains[${index}]`);
    assertCondition(typeof entry.summary === 'string' && entry.summary.length > 0, `Invalid summary at catalog.domains[${index}]`);

    return {
      id: String(entry.id),
      label: String(entry.label),
      icon: String(entry.icon),
      status: String(entry.status) as DomainStatus,
      manifest: parseString(entry.manifest, `catalog.domains[${index}].manifest`),
      skill: parseString(entry.skill, `catalog.domains[${index}].skill`),
      summary: String(entry.summary),
    };
  });

  return {
    schema_version: 'utopia.domain-catalog.v1',
    shell_version: parseString(raw.shell_version, 'catalog.shell_version'),
    active_domain_id: parseString(raw.active_domain_id, 'catalog.active_domain_id'),
    shell: {
      tabs: parseStringArray(shell.tabs, 'catalog.shell.tabs'),
      global_actions: parseStringArray(shell.global_actions, 'catalog.shell.global_actions'),
      action_policy: parseString(shell.action_policy, 'catalog.shell.action_policy'),
    },
    domains,
  };
}

export function getDomainManifest(domains: DomainCatalog['domains'], id: string): DomainManifest | undefined {
  const entry = domains.find((domain) => domain.id === id);
  if (!entry) return undefined;
  try {
    return parseDomainManifest(loadManifestByPath(entry.manifest), `domain-manifest:${id}`);
  } catch {
    return undefined;
  }
}

export function getManifestPath(domains: DomainCatalog['domains'], id: string): string | undefined {
  return domains.find((domain) => domain.id === id)?.manifest;
}

export function getDomainManifestByPath(domains: DomainCatalog['domains'], manifestPath: string): DomainManifest | undefined {
  const entry = domains.find((domain) => domain.manifest === manifestPath);
  if (!entry) return undefined;
  return getDomainManifest(domains, entry.id);
}

export function getBundledDomainManifest(id?: string): DomainManifest {
  const catalog = parseCatalog(catalogJson);
  const domainId = id?.trim() || catalog.active_domain_id;
  const entry = catalog.domains.find((domain) => domain.id === domainId);
  if (!entry) {
    throw new Error(`[domain-catalog] Bundled domain does not exist: ${domainId}`);
  }
  return parseDomainManifest(loadManifestByPath(entry.manifest), `domain-manifest:${entry.id}`);
}

export function getActiveManifestPath(): string {
  const { activeDomain } = loadCatalog();
  if (!activeDomain) {
    throw new Error('[domain-catalog] Missing active domain');
  }
  return activeDomain.manifest;
}

function loadManifestByPath(manifestPath: string, options: CatalogLoadOptions = {}): unknown {
  const manifestMap: Record<string, unknown> = {
    './domains/food.v1.json': foodManifestJson,
    './domains/health.v1.json': healthManifestJson,
    './domains/plants.v1.json': plantsManifestJson,
  };
  const manifest = manifestMap[manifestPath];
  if (manifest) {
    return manifest;
  }

  const runtimePackage = options.activePackage ?? activePackageOverride;
  if (runtimePackage && manifestPath === `app-package:${runtimePackage.id}@${runtimePackage.version}`) {
    return domainManifestFromPackage(runtimePackage);
  }

  throw new Error(`[domain-catalog] Unsupported manifest path: ${manifestPath}`);
}

function buildParsedCatalog(options: CatalogLoadOptions = {}): ParsedCatalog {
  const catalog = parseCatalog(catalogJson);
  const domainsById = Object.fromEntries(catalog.domains.map((domain) => [domain.id, domain])) as Record<string, DomainCatalogEntry>;
  const runtimePackage = options.activePackage ?? activePackageOverride;

  if (runtimePackage) {
    const activeManifest = domainManifestFromPackage(
      runtimePackage,
      getDomainManifest(catalog.domains, runtimePackage.id),
    );
    const activeDomain: DomainCatalogEntry = domainsById[activeManifest.id] ?? {
      id: activeManifest.id,
      label: activeManifest.label,
      icon: activeManifest.visual_identity?.domain?.icon ?? activeManifest.visual_identity?.domain?.emoji ?? 'box',
      status: 'active',
      manifest: `app-package:${runtimePackage.id}@${runtimePackage.version}`,
      skill: `package:${runtimePackage.id}`,
      summary: `${activeManifest.label} package`,
    };
    const nextDomainsById = { ...domainsById, [activeManifest.id]: activeDomain };
    return {
      catalog: { ...catalog, active_domain_id: activeManifest.id, domains: Object.values(nextDomainsById) },
      activeDomainId: activeManifest.id,
      activeDomain,
      activeManifest,
      domainsById: nextDomainsById,
    };
  }

  const requestedActiveDomainId = options.activeDomainId ?? activeDomainOverride;
  const activeDomainId = requestedActiveDomainId && domainsById[requestedActiveDomainId]
    ? requestedActiveDomainId
    : catalog.active_domain_id;
  const activeDomain = domainsById[activeDomainId];

  if (!activeDomain) {
    throw new Error(`[domain-catalog] Active domain does not exist: ${activeDomainId}`);
  }

  const activeManifest = parseDomainManifest(
    loadManifestByPath(activeDomain.manifest, options),
    `domain-manifest:${activeDomain.id}`
  );

  if (activeManifest.id !== activeDomain.id) {
    throw new Error(`[domain-catalog] Manifest id mismatch: ${activeManifest.id}`);
  }

  return { catalog, activeDomainId, activeDomain, activeManifest, domainsById };
}

export function loadCatalog(options: CatalogLoadOptions = {}): ParsedCatalog {
  if (options.activeDomainId !== undefined || options.activePackage !== undefined) {
    return buildParsedCatalog(options);
  }
  if (parsedCatalogCache) {
    return parsedCatalogCache;
  }
  parsedCatalogCache = buildParsedCatalog();
  return parsedCatalogCache;
}

function domainManifestFromPackage(pkg: AppPackage, bundledFallback?: DomainManifest): DomainManifest {
  const presentation = pkg.presentation;
  const collections = Object.keys(pkg.collections);
  const surfaces = presentation?.surfaces?.length
    ? presentation.surfaces.map((surface) => ({
      id: surface.id,
      label: surface.label,
      icon: surface.icon,
      image_url: surface.imageUrl,
      views: surface.views,
      collections: surface.collections,
    }))
    : Object.values(pkg.views).map((view) => ({
      id: view.id,
      label: view.id,
      views: [view.id],
      collections,
    }));

  return {
    schema_version: 'utopia.domain.v1',
    id: pkg.id,
    label: presentation?.label ?? bundledFallback?.label ?? pkg.id,
    home_surface: presentation?.homeSurface ?? bundledFallback?.home_surface,
    surfaces,
    collections,
    visual_identity: (presentation?.visualIdentity as DomainVisualIdentity | undefined) ?? bundledFallback?.visual_identity,
    relations: bundledFallback?.relations ?? [],
    skills: bundledFallback?.skills ?? [],
    workflows: bundledFallback?.workflows ?? [],
    data_homes: pkg.capabilities.filter((capability) => capability.startsWith('data-home:')).map((capability) => capability.slice('data-home:'.length)),
    dependency_pins: pkg.schemaVersion === 'wonder.app-package.v3' ? pkg.dependencyPins : bundledFallback?.dependency_pins,
    native_capabilities: pkg.schemaVersion === 'wonder.app-package.v3' ? pkg.nativeCapabilities : bundledFallback?.native_capabilities,
    ui: (presentation?.ui as DomainManifest['ui']) ?? bundledFallback?.ui,
    render: (presentation?.render as DomainRenderContract | undefined) ?? bundledFallback?.render,
    rich_detail_schema: presentation?.richDetailSchema ?? bundledFallback?.rich_detail_schema,
    provider_template_fields: (presentation?.providerTemplateFields as DomainManifest['provider_template_fields']) ?? bundledFallback?.provider_template_fields,
    mcp: {
      resources: pkg.capabilities.filter((capability) => capability.startsWith('mcp-resource:')).map((capability) => capability.slice('mcp-resource:'.length)),
      tools: pkg.capabilities.filter((capability) => capability.startsWith('mcp-tool:')).map((capability) => capability.slice('mcp-tool:'.length)),
    },
  };
}
