import { describe, expect, it } from 'vitest';

import type { PluginManifest } from '@/packages/shared/contracts/plugin';
import {
  checkBuildPluginCompatibility,
  checkPluginCompatibility,
  checkRuntimePluginCompatibility,
  checkServerPluginCompatibility,
} from '@/src/domain/plugin-resolver';

describe('plugin compatibility expanded consumers', () => {
  it('keeps runtime resolver behavior for build plugins', () => {
    const manifest: PluginManifest = {
      schemaVersion: 'utopia.plugin.v1',
      id: 'utopia.camera-capture',
      version: '2.0.0',
      pluginClass: 'build',
      runtimeTargets: ['android', 'ios'],
      provides: {
        widgets: ['camera'],
        tools: ['camera.capture'],
        dataSources: [],
        backgroundTasks: [],
      },
      permissions: ['camera'],
      packageDependencies: ['react-native-image-picker'],
    };

    const result = checkRuntimePluginCompatibility(manifest, {
      runtimeTarget: 'android',
      requiredCapabilities: ['widget:camera'],
    });

    expect(result.consumer).toBe('runtime');
    expect(result.status).toBe('requires_new_build');
  });

  it('lets the build resolver accept build plugins on declared targets', () => {
    const manifest: PluginManifest = {
      schemaVersion: 'utopia.plugin.v1',
      id: 'utopia.camera-capture',
      version: '2.0.0',
      pluginClass: 'build',
      runtimeTargets: ['android', 'ios'],
      provides: {
        widgets: ['camera'],
        tools: ['camera.capture'],
        dataSources: [],
        backgroundTasks: [],
      },
      permissions: ['camera'],
      packageDependencies: ['react-native-image-picker'],
    };

    const result = checkBuildPluginCompatibility(manifest, {
      runtimeTarget: 'android',
      requiredCapabilities: ['widget:camera', 'tool:camera.capture'],
    });

    expect(result.consumer).toBe('build');
    expect(result.status).toBe('compatible');
  });

  it('lets the server resolver accept server plugins when the trusted boundary is available', () => {
    const manifest: PluginManifest = {
      schemaVersion: 'utopia.plugin.v1',
      id: 'utopia.oauth',
      version: '1.0.0',
      pluginClass: 'server',
      runtimeTargets: ['server'],
      provides: {
        widgets: [],
        tools: ['oauth.exchange'],
        dataSources: ['crm'],
        backgroundTasks: [],
      },
      permissions: [],
      packageDependencies: ['@oauth/server'],
    };

    const result = checkServerPluginCompatibility(manifest, {
      runtimeTarget: 'server',
      requiredCapabilities: ['tool:oauth.exchange'],
      serverAvailable: true,
    });

    expect(result.consumer).toBe('server');
    expect(result.status).toBe('compatible');
  });

  it('routes generic requests through the named consumer', () => {
    const manifest: PluginManifest = {
      schemaVersion: 'utopia.plugin.v1',
      id: 'utopia.oauth',
      version: '1.0.0',
      pluginClass: 'server',
      runtimeTargets: ['server'],
      provides: {
        widgets: [],
        tools: ['oauth.exchange'],
        dataSources: ['crm'],
        backgroundTasks: [],
      },
      permissions: [],
      packageDependencies: ['@oauth/server'],
      fallback: {
        kind: 'render',
        text: 'Sign in on the shared web surface.',
      },
    };

    const result = checkPluginCompatibility(manifest, {
      consumer: 'runtime',
      runtimeTarget: 'web',
      requiredCapabilities: ['tool:oauth.exchange'],
      serverAvailable: false,
      allowFallback: true,
    });

    expect(result.consumer).toBe('runtime');
    expect(result.status).toBe('compatible_with_fallback');
    expect(result.fallback?.text).toBe('Sign in on the shared web surface.');
  });
});
