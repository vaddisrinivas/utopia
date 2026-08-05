import { defaultConfig } from '@tamagui/config/v5';
import { createTamagui } from '@tamagui/core';

export const tamaguiConfig = createTamagui(defaultConfig);

export default tamaguiConfig;

type UtopiaTamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends UtopiaTamaguiConfig {}
}
