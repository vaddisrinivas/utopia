import { useLocalSearchParams } from 'expo-router';

import { JsonRenderRoute } from '@/src/presentation/json-render-route';

export default function FoodScreen() {
  const params = useLocalSearchParams<{ screen?: string | string[] }>();
  const screen = typeof params.screen === 'string' ? params.screen : 'overview';
  return <JsonRenderRoute screen={screen} screenRouteBase="/(tabs)/food" />;
}
