import { useLocalSearchParams } from 'expo-router';

import { JsonRenderRoute } from '@/src/presentation/json-render-route';

export default function CollectionQueryScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; match?: string | string[]; title?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const match = Array.isArray(params.match) ? params.match[0] : params.match;
  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const ids = rawId?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];

  return (
    <JsonRenderRoute
      collectionIds={ids.length ? ids : undefined}
      recordMatch={match}
      screen="collection"
      screenTitle={title ?? rawId ?? 'Collection'}
      screenSubtitle="Every matching item in your kitchen. Tap one for full details."
      showBack
    />
  );
}
