import type { PlatformOSType, TextStyle, ViewStyle } from 'react-native';

import type { z } from 'zod';
import type { ResponsiveSchema } from './schema';

type Responsive = z.infer<typeof ResponsiveSchema>;
type Layout = NonNullable<Responsive['base']>;
type Style = ViewStyle & TextStyle;

type StyleAlias = Record<string, keyof Style>;

const styleMap: StyleAlias = {
  direction: 'flexDirection',
  dir: 'flexDirection',
  wrap: 'flexWrap',
  justify: 'justifyContent',
  justifyContent: 'justifyContent',
  align: 'alignItems',
  alignItems: 'alignItems',
  alignSelf: 'alignSelf',
  paddingX: 'paddingHorizontal',
  paddingY: 'paddingVertical',
  p: 'padding',
  px: 'paddingHorizontal',
  py: 'paddingVertical',
  pt: 'paddingTop',
  pr: 'paddingRight',
  pb: 'paddingBottom',
  pl: 'paddingLeft',
  m: 'margin',
  marginX: 'marginHorizontal',
  marginY: 'marginVertical',
  mx: 'marginHorizontal',
  my: 'marginVertical',
  mt: 'marginTop',
  mr: 'marginRight',
  mb: 'marginBottom',
  ml: 'marginLeft',
  radius: 'borderRadius',
  rounded: 'borderRadius',
  borderRadius: 'borderRadius',
  background: 'backgroundColor',
  bg: 'backgroundColor',
  foreground: 'color',
  fg: 'color',
  color: 'color',
  border: 'borderColor',
  borderColor: 'borderColor',
  width: 'width',
  w: 'width',
  height: 'height',
  h: 'height',
  minWidth: 'minWidth',
  minW: 'minWidth',
  maxWidth: 'maxWidth',
  maxW: 'maxWidth',
  minHeight: 'minHeight',
  minH: 'minHeight',
  maxHeight: 'maxHeight',
  maxH: 'maxHeight',
  gap: 'gap',
  gapX: 'columnGap',
  gapY: 'rowGap',
  opacity: 'opacity',
  fontSize: 'fontSize',
  size: 'fontSize',
};

const toStyleKey = (key: string): keyof Style => styleMap[key] ?? key as keyof Style;

function native(value: Layout = {}): Style {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [toStyleKey(key), item])) as Style;
}

export function layout(value: Responsive | undefined, width: number, height: number, platform: PlatformOSType | 'macos'): Style {
  if (!value) return {};
  const size = width < 600 ? value.compact : width < 1024 ? value.medium : value.wide;
  const orientation = width > height ? value.landscape : value.portrait;
  const responsive = native(value.base);
  const sized = native(size);
  const oriented = native(orientation);
  const platformStyle = native(value.platform?.[platform as keyof NonNullable<Responsive['platform']>]);
  return { ...responsive, ...sized, ...oriented, ...platformStyle };
}
