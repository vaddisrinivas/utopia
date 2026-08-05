import { ArrowDown, ArrowUp, MapPin, Plus, RefreshCcw, Route, Trash2, WifiOff } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Button, H2, Input, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui';
import { z } from 'zod';

const MAX_WAYPOINTS = 50;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const RouteWaypointSchema = z.object({
  id: z.string().regex(idPattern),
  label: z.string().trim().min(1).max(80),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  note: z.string().trim().max(160).optional(),
}).strict();

export const RouteConfigSchema = z.object({
  title: z.string().trim().min(1).max(80),
  waypoints: z.array(RouteWaypointSchema).max(MAX_WAYPOINTS),
  unit: z.enum(['km', 'mi']),
  speedKph: z.number().finite().positive().max(200),
  state: z.enum(['offline', 'ready', 'loading', 'error']),
  error: z.string().trim().min(1).max(160).optional(),
  retryLabel: z.string().trim().min(1).max(40),
}).strict().superRefine((config, context) => {
  const ids = new Set<string>();
  config.waypoints.forEach((waypoint, index) => {
    if (ids.has(waypoint.id)) {
      context.addIssue({ code: 'custom', path: ['waypoints', index, 'id'], message: `duplicate waypoint ${waypoint.id}` });
    }
    ids.add(waypoint.id);
  });
  if (config.state === 'error' && !config.error) {
    context.addIssue({ code: 'custom', path: ['error'], message: 'error state requires error text' });
  }
});

export type RouteWaypoint = z.infer<typeof RouteWaypointSchema>;
export type RouteConfig = z.infer<typeof RouteConfigSchema>;
export type RouteState = RouteConfig['state'];
export type RouteLeg = { from: string; to: string; distanceMeters: number };
export type RouteMetrics = { distanceMeters: number; etaMinutes: number; legs: RouteLeg[] };
export type RouteWidgetProps = {
  config: unknown;
  onChange?(config: RouteConfig): void;
  onRetry?(): void;
};

export function parseRouteConfig(value: unknown): RouteConfig {
  return RouteConfigSchema.parse(value);
}

const earthRadiusMeters = 6_371_000;
const radians = (value: number) => value * Math.PI / 180;

export function distanceMeters(from: RouteWaypoint, to: RouteWaypoint): number {
  const latitude = radians(to.latitude - from.latitude);
  const longitude = radians(to.longitude - from.longitude);
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitude / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function routeMetrics(config: RouteConfig): RouteMetrics {
  const legs: RouteLeg[] = [];
  for (let index = 1; index < config.waypoints.length; index += 1) {
    const from = config.waypoints[index - 1];
    const to = config.waypoints[index];
    legs.push({ from: from.id, to: to.id, distanceMeters: distanceMeters(from, to) });
  }
  const distance = legs.reduce((total, leg) => total + leg.distanceMeters, 0);
  return { distanceMeters: distance, etaMinutes: distance / 1000 / config.speedKph * 60, legs };
}

export function reorderWaypoints(config: RouteConfig, fromIndex: number, toIndex: number): RouteConfig {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= config.waypoints.length || toIndex >= config.waypoints.length || fromIndex === toIndex) return config;
  const waypoints = [...config.waypoints];
  const [waypoint] = waypoints.splice(fromIndex, 1);
  waypoints.splice(toIndex, 0, waypoint);
  return { ...config, waypoints };
}

export function addWaypoint(config: RouteConfig, waypoint: unknown): RouteConfig {
  if (config.waypoints.length >= MAX_WAYPOINTS) return config;
  const parsed = RouteWaypointSchema.parse(waypoint);
  if (config.waypoints.some((item) => item.id === parsed.id)) return config;
  return { ...config, waypoints: [...config.waypoints, parsed] };
}

export function deleteWaypoint(config: RouteConfig, id: string): RouteConfig {
  return { ...config, waypoints: config.waypoints.filter((waypoint) => waypoint.id !== id) };
}

export function retryRoute(config: RouteConfig): RouteConfig {
  return { ...config, state: 'loading', error: undefined };
}

function formatDistance(meters: number, unit: RouteConfig['unit']): string {
  const value = unit === 'mi' ? meters / 1609.344 : meters / 1000;
  return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
}

function formatEta(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  if (minutes < 60) return `${Math.ceil(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.ceil(minutes % 60);
  return `${hours}h${rest ? ` ${rest}m` : ''}`;
}

function plotPosition(waypoint: RouteWaypoint, waypoints: RouteWaypoint[]): { left: number; top: number } {
  const longitudes = waypoints.map((item) => item.longitude);
  const latitudes = waypoints.map((item) => item.latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitudeRange = Math.max(maxLongitude - minLongitude, 0.0001);
  const latitudeRange = Math.max(maxLatitude - minLatitude, 0.0001);
  return {
    left: 10 + ((waypoint.longitude - minLongitude) / longitudeRange) * 80,
    top: 10 + ((maxLatitude - waypoint.latitude) / latitudeRange) * 72,
  };
}

function RoutePreview({ waypoints }: { waypoints: RouteWaypoint[] }) {
  if (!waypoints.length) return <Paragraph color="$color10">Add a waypoint to preview the route.</Paragraph>;
  return <YStack gap="$2" aria-label="Route preview">
    <XStack gap="$2" style={{ alignItems: 'center' }}><Route size={16} /><Text fontWeight="700">Route preview</Text><Text color="$color10">JSON coordinates</Text></XStack>
    <View style={{ height: 170, borderRadius: 8, borderWidth: 1, borderColor: '#D6DED8', backgroundColor: '#F2F7F1', position: 'relative' } as ViewStyle}>
      {waypoints.map((waypoint, index) => {
        const position = plotPosition(waypoint, waypoints);
        return <View key={waypoint.id} style={{ position: 'absolute', left: `${position.left}%`, top: `${position.top}%`, alignItems: 'center' } as ViewStyle}>
          <MapPin size={20} color="#18794E" />
          <Text fontSize="$2" fontWeight="700">{index + 1}</Text>
        </View>;
      })}
    </View>
    <Text color="$color10">{waypoints.map((waypoint, index) => `${index + 1}. ${waypoint.label}`).join('  ->  ')}</Text>
  </YStack>;
}

function stateNotice(config: RouteConfig, onRetry?: () => void) {
  if (config.state === 'offline') return <XStack gap="$2" style={{ alignItems: 'center' }}><WifiOff size={18} /><Paragraph>Offline route plan. No provider or GPS call.</Paragraph></XStack>;
  if (config.state === 'loading') return <Paragraph color="$color10">Preparing route from saved waypoints.</Paragraph>;
  if (config.state === 'error') return <XStack gap="$2" style={{ alignItems: 'center', justifyContent: 'space-between' }}><Paragraph color="$red10">{config.error}</Paragraph><Button size="$3" icon={RefreshCcw} onPress={onRetry} aria-label={config.retryLabel}>{config.retryLabel}</Button></XStack>;
  return <Paragraph color="$color10">Local route plan.</Paragraph>;
}

function nextId(waypoints: RouteWaypoint[]): string {
  let index = waypoints.length + 1;
  while (waypoints.some((waypoint) => waypoint.id === `waypoint-${index}`)) index += 1;
  return `waypoint-${index}`;
}

export function RouteWidget({ config: rawConfig, onChange, onRetry }: RouteWidgetProps) {
  const parsed = useMemo(() => parseRouteConfig(rawConfig), [rawConfig]);
  const [config, setConfig] = useState(parsed);
  const [label, setLabel] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [addError, setAddError] = useState('');
  useEffect(() => setConfig(parsed), [parsed]);
  const metrics = routeMetrics(config);
  const commit = (next: RouteConfig) => { setConfig(next); onChange?.(next); };
  const add = () => {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!label.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      setAddError('Name and valid coordinates required');
      return;
    }
    try {
      const next = addWaypoint(config, { id: nextId(config.waypoints), label, latitude: lat, longitude: lon });
      commit(next); setLabel(''); setLatitude(''); setLongitude(''); setAddError('');
    } catch { setAddError('Waypoint limit reached'); }
  };
  return <YStack gap="$3" style={{ padding: 16, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6DED8' }}>
    <XStack gap="$2" style={{ alignItems: 'center' }}><Route size={20} color="#18794E" /><H2 size="$6">{config.title}</H2></XStack>
    {stateNotice(config, () => { commit(retryRoute(config)); onRetry?.(); })}
    <XStack gap="$3"><YStack flex={1}><Text fontWeight="700">Distance</Text><Text>{formatDistance(metrics.distanceMeters, config.unit)}</Text></YStack><YStack flex={1}><Text fontWeight="700">ETA</Text><Text>{formatEta(metrics.etaMinutes)}</Text></YStack></XStack>
    <RoutePreview waypoints={config.waypoints} />
    <YStack gap="$2" aria-label="Route waypoints">
      <Text fontWeight="700">Waypoints ({config.waypoints.length}/{MAX_WAYPOINTS})</Text>
      <ScrollView accessibilityLabel="Route waypoint list">
        {config.waypoints.map((waypoint, index) => <XStack key={waypoint.id} gap="$2" style={{ alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderColor: '#E6ECE7' }}>
          <Text fontWeight="700" width={24}>{index + 1}</Text><YStack flex={1}><Text fontWeight="700">{waypoint.label}</Text><Text color="$color10" fontSize="$2">{waypoint.latitude.toFixed(4)}, {waypoint.longitude.toFixed(4)}</Text></YStack>
          <Button circular size="$3" icon={ArrowUp} disabled={index === 0} onPress={() => commit(reorderWaypoints(config, index, index - 1))} aria-label={`Move ${waypoint.label} up`} />
          <Button circular size="$3" icon={ArrowDown} disabled={index === config.waypoints.length - 1} onPress={() => commit(reorderWaypoints(config, index, index + 1))} aria-label={`Move ${waypoint.label} down`} />
          <Button circular size="$3" icon={Trash2} onPress={() => commit(deleteWaypoint(config, waypoint.id))} aria-label={`Delete ${waypoint.label}`} />
        </XStack>)}
      </ScrollView>
    </YStack>
    <YStack gap="$2" aria-label="Add waypoint">
      <Text fontWeight="700">Add waypoint</Text>
      <Input value={label} onChangeText={setLabel} placeholder="Name" aria-label="Waypoint name" />
      <XStack gap="$2"><Input flex={1} value={latitude} onChangeText={setLatitude} placeholder="Latitude" keyboardType="decimal-pad" aria-label="Waypoint latitude" /><Input flex={1} value={longitude} onChangeText={setLongitude} placeholder="Longitude" keyboardType="decimal-pad" aria-label="Waypoint longitude" /></XStack>
      {addError ? <Paragraph color="$red10">{addError}</Paragraph> : null}
      <Button icon={Plus} onPress={add} disabled={config.waypoints.length >= MAX_WAYPOINTS} aria-label="Add waypoint">Add waypoint</Button>
    </YStack>
  </YStack>;
}
