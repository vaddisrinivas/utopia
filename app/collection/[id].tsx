import { useLocalSearchParams } from 'expo-router';

import { JsonRenderRoute } from '@/src/presentation/json-render-route';

export default function CollectionScreen() {
  const params = useLocalSearchParams<{ id?: string; match?: string; title?: string }>();
  const collectionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const match = Array.isArray(params.match) ? params.match[0] : params.match;
  const title = Array.isArray(params.title) ? params.title[0] : params.title;

  return (
    <JsonRenderRoute
      screen="collection"
      collectionIds={collectionId?.split(',').filter(Boolean)}
      recordMatch={match}
      screenTitle={title ?? collectionId?.replaceAll('_', ' ')}
      screenSubtitle="Every matching item in your kitchen. Tap one for full details."
      emptyTitle="No matching items yet."
      showBack
    />
  );
}
