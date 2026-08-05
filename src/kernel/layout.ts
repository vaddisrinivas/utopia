import type { PlatformOSType, TextStyle, ViewStyle } from 'react-native';

import type { z } from 'zod';
import type { ResponsiveSchema } from './schema';

type Responsive = z.infer<typeof ResponsiveSchema>;
type Layout = NonNullable<Responsive['base']>;
type Style = ViewStyle & TextStyle;

const map: Record<string, keyof Style> = {
  direction: 'flexDirection', wrap: 'flexWrap', justify: 'justifyContent', align: 'alignItems',
  paddingX: 'paddingHorizontal', paddingY: 'paddingVertical', marginX: 'marginHorizontal',
  marginY: 'marginVertical', radius: 'borderRadius', background: 'backgroundColor',
  border: 'borderColor', foreground: 'color',
};

function native(value: Layout = {}): Style {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [map[key] ?? key, item])) as Style;
}

export function layout(value: Responsive | undefined, width: number, height: number, platform: PlatformOSType | 'macos'): Style {
  if (!value) return {};
  const size = width < 600 ? value.compact : width < 1024 ? value.medium : value.wide;
  const orientation = width > height ? value.landscape : value.portrait;
  return { ...native(value.base), ...native(size), ...native(orientation), ...native(value.platform?.[platform as keyof NonNullable<Responsive['platform']>]) };
}
