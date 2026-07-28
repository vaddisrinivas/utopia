import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  collectPluginValidationErrors,
  lockPluginManifest,
  resolvePluginCompatibility,
  type PluginCompatibilityStatus,
  type PluginManifest,
} from '@/packages/shared/contracts/plugin';

vi.mock('expo-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

vi.mock('@json-render/react-native', () => ({
  JSONUIProvider: ({ children }: { children: unknown }) => children,
  Renderer: () => null,
  createStandardActionHandlers: () => ({}),
}));

vi.mock('@/src/presentation/json-render-widgets', () => ({
  JSON_RENDER_WIDGET_REGISTRY: {},
}));

vi.mock('@/src/theme', () => ({
  useUtopiaTheme: () => ({ dark: false }),
}));

let buildJsonRenderSpec: typeof import('@/src/presentation/json-render-surface').buildJsonRenderSpec;

beforeAll(async () => {
  ({ buildJsonRenderSpec } = await import('@/src/presentation/json-render-surface'));
});

describe('plugin compatibility contract', () => {
  const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/plugins');
  const manifest = JSON.parse(readFileSync(path.join(fixtureDir, 'manifest.json'), 'utf8')) as Array<{
    path: string;
    valid: boolean;
    expectedStatus?: PluginCompatibilityStatus;
    expectedFallbackText?: string;
    errorContains?: string;
  }>;

  for (const fixture of manifest) {
    it(fixture.path, () => {
      const raw = JSON.parse(readFileSync(path.join(fixtureDir, fixture.path), 'utf8')) as {
        manifest: PluginManifest;
        request?: {
          runtimeTarget: string;
          requiredCapabilities: string[];
          optionalCapabilities?: string[];
          serverAvailable?: boolean;
          allowFallback?: boolean;
        };
        expectedLock?: {
          capabilities: string[];
          checksum: string;
        };
        renderProof?: {
          title: string;
          screen: string;
          expectedText: string;
          ui: Parameters<typeof buildJsonRenderSpec>[0]['ui'];
        };
      };

      const errors = collectPluginValidationErrors(raw.manifest);
      if (!fixture.valid) {
        expect(errors.some((error) => error.includes(fixture.errorContains ?? ''))).toBe(true);
        return;
      }

      expect(errors).toEqual([]);
      const lock = lockPluginManifest(raw.manifest);
      if (raw.expectedLock) {
        expect(lock.capabilities).toEqual([...raw.expectedLock.capabilities].sort());
        expect(lock.checksum).toBe(raw.expectedLock.checksum);
      }

      if (raw.request && fixture.expectedStatus) {
        const result = resolvePluginCompatibility(raw.manifest, raw.request);
        expect(result.status).toBe(fixture.expectedStatus);
        expect(result.lock.checksum).toBe(lock.checksum);
        if (fixture.expectedFallbackText) {
          expect(result.fallback?.text).toBe(fixture.expectedFallbackText);
        }
      }

      if (raw.renderProof) {
        const spec = buildJsonRenderSpec({
          title: raw.renderProof.title,
          screen: raw.renderProof.screen,
          ui: raw.renderProof.ui,
          records: [],
        });
        expect(specText(spec)).toContain(raw.renderProof.expectedText);
      }

      expect(lock.capabilities.some((capability) => capability.startsWith('record:'))).toBe(false);
    });
  }
});

function specText(spec: { elements: Record<string, { props?: Record<string, unknown> }> }) {
  return Object.values(spec.elements)
    .flatMap((element) => Object.values(element.props ?? {}))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
}

