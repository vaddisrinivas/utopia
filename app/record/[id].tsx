import { useLocalSearchParams } from 'expo-router';

import { JsonRenderRoute } from '@/src/presentation/json-render-route';

export default function RecordScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const recordId = Array.isArray(params.id) ? params.id[0] : params.id;
  return <JsonRenderRoute screen="record" recordId={recordId} showBack />;
}
