import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('lucide-react-native', () => ({ ArrowDown: 'ArrowDown', ArrowUp: 'ArrowUp', MapPin: 'MapPin', Plus: 'Plus', RefreshCcw: 'RefreshCcw', Route: 'Route', Trash2: 'Trash2', WifiOff: 'WifiOff' }));
vi.mock('tamagui', () => ({ Button: 'Button', H2: 'H2', Input: 'Input', Paragraph: 'Paragraph', ScrollView: 'ScrollView', Text: 'Text', XStack: 'XStack', YStack: 'YStack' }));

import {
  RouteConfigSchema,
  addWaypoint,
  deleteWaypoint,
  distanceMeters,
  parseRouteConfig,
  reorderWaypoints,
  retryRoute,
  routeMetrics,
  type RouteConfig,
} from '@/src/kernel/route-widget';

const config: RouteConfig = {
  title: 'Morning route',
  waypoints: [
    { id: 'home', label: 'Home', latitude: 40.7128, longitude: -74.006 },
    { id: 'park', label: 'Park', latitude: 40.7306, longitude: -73.9866 },
    { id: 'work', label: 'Work', latitude: 40.7484, longitude: -73.9857 },
  ],
  unit: 'km', speedKph: 30, state: 'offline', retryLabel: 'Retry',
};

describe('route widget V3 contract', () => {
  it('strictly parses bounded JSON config and rejects unknown keys or duplicate ids', () => {
    expect(parseRouteConfig(config)).toEqual(config);
    expect(() => RouteConfigSchema.parse({ ...config, extra: true })).toThrow();
    expect(() => parseRouteConfig({ ...config, waypoints: [{ ...config.waypoints[0], id: 'home' }, ...config.waypoints] })).toThrow(/duplicate waypoint/);
    expect(() => parseRouteConfig({ ...config, waypoints: [{ ...config.waypoints[0], latitude: 91 }] })).toThrow();
  });

  it('calculates haversine distance, ordered legs, and ETA from local waypoints', () => {
    expect(distanceMeters(config.waypoints[0], config.waypoints[1])).toBeGreaterThan(0);
    const metrics = routeMetrics(config);
    expect(metrics.legs.map((leg) => [leg.from, leg.to])).toEqual([['home', 'park'], ['park', 'work']]);
    expect(metrics.distanceMeters).toBeCloseTo(metrics.legs.reduce((sum, leg) => sum + leg.distanceMeters, 0));
    expect(metrics.etaMinutes).toBeCloseTo(metrics.distanceMeters / 1000 / 30 * 60);
  });

  it('supports immutable add, reorder, and delete with duplicate and capacity guards', () => {
    const added = addWaypoint(config, { id: 'cafe', label: 'Cafe', latitude: 40.75, longitude: -73.99 });
    expect(added.waypoints.map((item) => item.id)).toEqual(['home', 'park', 'work', 'cafe']);
    expect(addWaypoint(added, added.waypoints[0])).toBe(added);
    expect(reorderWaypoints(added, 3, 0).waypoints[0].id).toBe('cafe');
    expect(deleteWaypoint(added, 'park').waypoints.map((item) => item.id)).toEqual(['home', 'work', 'cafe']);
    expect(config.waypoints).toHaveLength(3);
  });

  it('represents retry without executing GPS or a provider', () => {
    const failed = parseRouteConfig({ ...config, state: 'error', error: 'No network' });
    expect(retryRoute(failed)).toMatchObject({ state: 'loading', error: undefined, waypoints: failed.waypoints });
  });

  it('caps route data at fifty waypoints', () => {
    const waypoints = Array.from({ length: 50 }, (_, index) => ({ id: `p-${index}`, label: `Point ${index}`, latitude: index - 25, longitude: index - 25 }));
    const full = parseRouteConfig({ ...config, waypoints });
    expect(full.waypoints).toHaveLength(50);
    expect(addWaypoint(full, { id: 'overflow', label: 'Overflow', latitude: 0, longitude: 0 })).toBe(full);
    expect(() => parseRouteConfig({ ...config, waypoints: [...waypoints, waypoints[0]] })).toThrow();
  });
});
