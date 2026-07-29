import { useRouter } from 'expo-router';
import { useEffect } from 'react';

export default function HomeScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/install');
  }, [router]);

  return null;
}
