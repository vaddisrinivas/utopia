import { APP_PACKAGE_WIDGET_KINDS } from '@/packages/shared/contracts/ui-widgets';
import { expressionSchemaDefinition } from '@/packages/shared/contracts/expression';

export const APP_PACKAGE_SCHEMA_DRAFT = 'http://json-schema.org/draft-07/schema#' as const;
export const APP_PACKAGE_SCHEMA_ID_V2 = 'https://wonder.local/schemas/app-package/v2' as const;
export const APP_PACKAGE_SCHEMA_ID_V3 = 'https://wonder.local/schemas/app-package/v3' as const;

/** Shared executable-data package boundary. No code fields are permitted. */
export const appPackageSchemaV2 = {
  $id: APP_PACKAGE_SCHEMA_ID_V2,
  $schema: APP_PACKAGE_SCHEMA_DRAFT,
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'version', 'collections', 'queries', 'views', 'rules', 'capabilities', 'acceptanceTests'],
  properties: {
    schemaVersion: { const: 'wonder.app-package.v2' },
    id: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },
    collections: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'fields'],
        properties: {
          id: { type: 'string', minLength: 1 },
          fields: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              additionalProperties: false,
              required: ['type'],
              properties: {
                type: { enum: ['text', 'number', 'boolean', 'timestamp', 'json'] },
                required: { type: 'boolean' },
                indexed: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    queries: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['from'],
        properties: {
          from: { type: 'string', minLength: 1 },
          where: { $ref: '#/$defs/predicate' },
          orderBy: { type: 'array', items: { type: 'object', required: ['field'], additionalProperties: false, properties: { field: { type: 'string', minLength: 1 }, direction: { enum: ['asc', 'desc'] } } } },
          limit: { type: 'integer', minimum: 0 },
        },
      },
    },
    views: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'query', 'mode', 'fields'],
        properties: {
          id: { type: 'string', minLength: 1 },
          query: { type: 'string', minLength: 1 },
          mode: { enum: ['list', 'board', 'table', 'calendar', 'timeline', 'chart'] },
          fields: { type: 'array', items: { type: 'string', minLength: 1 } },
          groupBy: { type: 'string', minLength: 1 },
          layout: { $ref: '#/$defs/viewLayout' },
        },
      },
    },
    presentation: { $ref: '#/$defs/presentation' },
    computedFields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'collection', 'dependsOn', 'expression'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
          collection: { type: 'string', minLength: 1 },
          dependsOn: {
            type: 'array',
            uniqueItems: true,
            items: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
          },
          expression: { $ref: '#/$defs/expression' },
        },
      },
    },
    rules: {
      type: 'array',
      items: { $ref: '#/$defs/rule' },
    },
    capabilities: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' },
    },
    acceptanceTests: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' },
    },
  },
  $defs: {
    jsonValue: {
      anyOf: [
        { type: 'null' },
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'array', items: { $ref: '#/$defs/jsonValue' } },
        { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
      ],
    },
    presentation: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'surfaces'],
      properties: {
        label: { type: 'string', minLength: 1 },
        homeSurface: { type: 'string', minLength: 1 },
        surfaces: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'label', 'collections'],
            properties: {
              id: { type: 'string', minLength: 1 },
              label: { type: 'string', minLength: 1 },
              icon: { type: 'string' },
              imageUrl: { type: 'string' },
              views: { type: 'array', items: { type: 'string' } },
              collections: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        visualIdentity: { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
        render: { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
        ui: { $ref: '#/$defs/presentationUi' },
        richDetailSchema: { type: 'string', minLength: 1 },
        providerTemplateFields: { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
        sourceSchemaVersion: { type: 'string', minLength: 1 },
      },
    },
    presentationUi: {
      type: 'object',
      additionalProperties: false,
      properties: {
        schemaVersion: { const: 'a2ui.v0_9' },
        localization: { $ref: '#/$defs/presentationLocalization' },
        openUrlAllowlist: { type: 'array', items: { type: 'string', minLength: 1 } },
        navigation: { $ref: '#/$defs/presentationNavigation' },
        components: {
          type: 'array',
          items: { $ref: '#/$defs/presentationUiComponent' },
        },
        screens: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/presentationScreen' },
        },
        defaultScreen: { type: 'string', minLength: 1 },
      },
    },
    presentationLocalization: {
      type: 'object',
      additionalProperties: false,
      required: ['defaultLocale', 'messages'],
      properties: {
        defaultLocale: { type: 'string', pattern: '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$' },
        fallbackLocale: { type: 'string', pattern: '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$' },
        appLocale: { type: 'string', pattern: '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$' },
        messages: {
          type: 'object',
          additionalProperties: false,
          patternProperties: {
            '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$': {
              type: 'object',
              additionalProperties: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
    presentationNavigation: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['screen', 'label'],
            properties: {
              screen: { type: 'string', minLength: 1 },
              label: { type: 'string', minLength: 1 },
              icon: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
    presentationUiAction: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { enum: ['open_url', 'propose'] },
        label: { type: 'string', minLength: 1 },
        url: { type: 'string', minLength: 1 },
        command: { type: 'string', minLength: 1 },
        tool: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.:-]*$' },
        payload: { type: 'object', additionalProperties: true },
      },
      allOf: [
        {
          if: { properties: { kind: { const: 'open_url' } } },
          then: { required: ['url'] },
        },
        {
          if: { properties: { kind: { const: 'propose' } } },
          then: {
            anyOf: [
              { required: ['tool'] },
              { required: ['command'] },
            ],
          },
        },
      ],
    },
    presentationUiQuery: {
      type: 'object',
      additionalProperties: false,
      properties: {
        collections: { type: 'array', items: { type: 'string', minLength: 1 } },
        match: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    presentationUiDataBinding: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'xField', 'yField'],
          properties: {
            source: { const: 'query-records' },
            xField: { type: 'string', minLength: 1 },
            yField: { type: 'string', minLength: 1 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'aggregate'],
          properties: {
            source: { const: 'query-aggregate' },
            aggregate: { enum: ['count', 'sum', 'avg', 'min', 'max'] },
            valueField: { type: 'string', minLength: 1 },
            groupBy: { type: 'string', minLength: 1 },
            labelField: { type: 'string', minLength: 1 },
          },
        },
      ],
    },
    presentationUiComponent: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { enum: ['recordList', 'metric', 'action', 'text', 'widget'] },
        id: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        subtitle: { type: 'string', minLength: 1 },
        widget: { enum: APP_PACKAGE_WIDGET_KINDS },
        props: { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
        view: { type: 'string', minLength: 1 },
        tone: { enum: ['neutral', 'moss', 'amber', 'plum', 'blue'] },
        placement: { enum: ['inline', 'top', 'fab'] },
        query: { $ref: '#/$defs/presentationUiQuery' },
        dataBinding: { $ref: '#/$defs/presentationUiDataBinding' },
        dataState: { enum: ['loading', 'ready', 'error'] },
        dataError: { type: 'string', minLength: 1 },
        action: { $ref: '#/$defs/presentationUiAction' },
      },
      allOf: [
        {
          if: { properties: { kind: { const: 'widget' } } },
          then: { required: ['widget'] },
        },
      ],
    },
    presentationScreen: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1 },
        subtitle: { type: 'string', minLength: 1 },
        shell: { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
        components: { type: 'array', items: { $ref: '#/$defs/presentationUiComponent' } },
      },
    },
    viewLayout: {
      type: 'object',
      additionalProperties: false,
      properties: {
        size: { enum: ['compact', 'standard', 'wide', 'feature'] },
        tone: { enum: ['neutral', 'moss', 'amber', 'plum', 'blue'] },
        href: { type: 'string', minLength: 1 },
      },
    },
    rule: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'trigger', 'effect', 'mode', 'maxRunsPerEvent'],
      properties: {
        id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.:-]*$' },
        trigger: { $ref: '#/$defs/ruleTrigger' },
        when: {},
        effect: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'operation'],
          properties: {
            kind: { const: 'propose_operation' },
            operation: {
              oneOf: [
                { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.:-]*$' },
                { $ref: '#/$defs/operationTemplate' },
              ],
            },
          },
        },
        mode: { enum: ['suggest', 'automatic'] },
        maxRunsPerEvent: { type: 'integer', minimum: 1, maximum: 64 },
      },
    },
    ruleTrigger: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { enum: ['operation', 'schedule'] } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'query'],
          properties: {
            kind: { const: 'query_transition' },
            query: { type: 'string', minLength: 1 },
            transition: { enum: ['enter', 'leave', 'change'] },
          },
        },
      ],
    },
    operationTemplate: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'tool'],
          properties: {
            kind: { const: 'custom' },
            tool: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.:-]*$' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'collection'],
          properties: {
            kind: { const: 'create_record' },
            domain: { type: 'string', minLength: 1 },
            collection: { type: 'string', minLength: 1 },
            recordId: { type: 'string', minLength: 1 },
            properties: { type: 'object' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'recordId', 'changes'],
          properties: {
            kind: { const: 'update_record' },
            domain: { type: 'string', minLength: 1 },
            collection: { type: 'string', minLength: 1 },
            recordId: { type: 'string', minLength: 1 },
            expectedRevision: { type: 'integer', minimum: 0 },
            changes: { type: 'object' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'recordId'],
          properties: {
            kind: { enum: ['archive_record', 'restore_record'] },
            domain: { type: 'string', minLength: 1 },
            collection: { type: 'string', minLength: 1 },
            recordId: { type: 'string', minLength: 1 },
            expectedRevision: { type: 'integer', minimum: 0 },
          },
        },
      ],
    },
    predicate: {
      oneOf: [
        { type: 'object', required: ['op', 'args'], additionalProperties: false, properties: { op: { enum: ['and', 'or'] }, args: { type: 'array', minItems: 1, items: { $ref: '#/$defs/predicate' } } } },
        { type: 'object', required: ['op', 'arg'], additionalProperties: false, properties: { op: { const: 'not' }, arg: { $ref: '#/$defs/predicate' } } },
        { type: 'object', required: ['op', 'field', 'value'], additionalProperties: false, properties: { op: { enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with'] }, field: { type: 'string', minLength: 1 }, value: {} } },
        { type: 'object', required: ['op', 'field'], additionalProperties: false, properties: { op: { const: 'exists' }, field: { type: 'string', minLength: 1 }, value: { type: 'boolean' } } },
      ],
    },
    expression: expressionSchemaDefinition,
  },
} as const;

export const appPackageSchemaV3 = {
  ...appPackageSchemaV2,
  $id: APP_PACKAGE_SCHEMA_ID_V3,
  properties: {
    ...appPackageSchemaV2.properties,
    schemaVersion: { const: 'wonder.app-package.v3' },
    dependencyPins: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { $ref: '#/$defs/dependencyPin' },
    },
    nativeCapabilities: { $ref: '#/$defs/nativeCapability' },
    contractLock: { $ref: '#/$defs/contractLock' },
  },
  required: [...appPackageSchemaV2.required, 'dependencyPins', 'nativeCapabilities', 'contractLock'],
  $defs: {
    ...appPackageSchemaV2.$defs,
    dependencyPin: {
      type: 'object',
      additionalProperties: false,
      required: ['package', 'version'],
      properties: {
        package: { type: 'string', pattern: '^@[a-zA-Z0-9][a-zA-Z0-9_./:-]*$|^[a-zA-Z0-9][a-zA-Z0-9_./:-]*$' },
        version: { type: 'string', minLength: 1 },
        source: { enum: ['npm', 'maven', 'gradle', 'cocoapods', 'other'] },
      },
    },
    nativeCapability: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'platform', 'packages'],
      properties: {
        schemaVersion: { const: 'wonder.app-package-native-capabilities.v1' },
        platform: { enum: ['expo', 'android', 'ios', 'web'] },
        packages: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        permissions: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string', minLength: 1 },
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'platform', 'permission', 'reason'],
                properties: {
                  id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' },
                  platform: { enum: ['expo', 'android', 'ios', 'web'] },
                  permission: { type: 'string', minLength: 1 },
                  reason: { type: 'string', minLength: 1 },
                  required: { type: 'boolean' },
                  prompt: { type: 'string', minLength: 1 },
                },
              },
            ],
          },
        },
        intents: {
          type: 'array',
          uniqueItems: true,
          items: { $ref: '#/$defs/nativeIntent' },
        },
      },
    },
    nativeIntent: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'platform', 'kind', 'reason'],
      properties: {
        id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' },
        platform: { enum: ['expo', 'android', 'ios', 'web'] },
        kind: { enum: ['share', 'deep_link', 'shortcut', 'voice', 'background_task', 'file_open', 'url_open'] },
        reason: { type: 'string', minLength: 1 },
        required: { type: 'boolean' },
        payload: { type: 'object', additionalProperties: true },
      },
    },
    contractLock: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'algorithm', 'checksum', 'pinnedAt', 'dependencyPins', 'nativeCapabilities'],
      properties: {
        schemaVersion: { const: 'wonder.package-contract-lock.v1' },
        algorithm: { const: 'sha256' },
        checksum: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
        pinnedAt: { type: 'string', format: 'date-time' },
        dependencyPins: { type: 'array', items: { $ref: '#/$defs/dependencyPin' } },
        nativeCapabilities: { $ref: '#/$defs/nativeCapability' },
      },
    },
  },
} as const;

export const appPackageSchema = {
  $schema: APP_PACKAGE_SCHEMA_DRAFT,
  oneOf: [appPackageSchemaV2, appPackageSchemaV3],
} as const;
