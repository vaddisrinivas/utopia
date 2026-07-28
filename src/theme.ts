import { Platform, useColorScheme } from 'react-native';

import { useUtopiaSettingsSnapshot } from '@/src/settings/utopia-settings';

export const colors = {
  ink: '#182019',
  muted: '#657066',
  canvas: '#F6F7F4',
  paper: '#FFFFFF',
  line: '#DDE3DC',
  moss: '#2F7448',
  mossSoft: '#E4F1E8',
  plum: '#72526D',
  plumSoft: '#EFE6ED',
  amber: '#B85F25',
  amberSoft: '#F9E7D9',
  blue: '#32667A',
  blueSoft: '#E3EFF3',
  red: '#B94837',
};

export const radius = { sm: 10, md: 16, lg: 24, pill: 999 };

export const shadow = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(24, 32, 25, 0.05)' },
  default: {
    shadowColor: '#182019',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 0,
  },
}) ?? {};

export const darkColors = {
  ink: '#F4F0E6',
  muted: '#B9B2A3',
  canvas: '#11130F',
  paper: '#191B16',
  line: '#34372D',
  moss: '#A9C891',
  mossSoft: '#263220',
  plum: '#D9AFD0',
  plumSoft: '#342637',
  amber: '#F0B173',
  amberSoft: '#3C291B',
  blue: '#9FC7D8',
  blueSoft: '#1F3138',
  red: '#E28E85',
};

export type UtopiaColors = typeof colors;

export function useUtopiaTheme() {
  const { runtime } = useUtopiaSettingsSnapshot();
  const system = useColorScheme();
  const dark = runtime.theme === 'dark' || (runtime.theme === 'system' && system === 'dark');
  return {
    colors: dark ? darkColors : colors,
    dark,
    density: runtime.density,
  };
}
