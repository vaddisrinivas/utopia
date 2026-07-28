import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useAppRuntime } from '@/src/domain/runtime-context';
import { JsonRenderRoute } from '@/src/presentation/json-render-route';

export default function HomeScreen() {
  const router = useRouter();
  const { activePackage } = useAppRuntime();

  useEffect(() => {
    if (!activePackage) router.replace('/install');
  }, [activePackage, router]);

  if (!activePackage) return null;

  return <JsonRenderRoute screen="home" />;
}
