import { Link } from 'expo-router';
import { Button, H1, YStack } from 'tamagui';

export default function NotFound() {
  return <YStack style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} gap="$4"><H1>Not found</H1><Link href="/" asChild><Button>Apps</Button></Link></YStack>;
}
