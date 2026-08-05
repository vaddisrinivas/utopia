import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Button, H2, XStack, YStack } from 'tamagui';

import type { AppComponent } from './schema';

const text = (value: unknown) => typeof value === 'string' ? value : '';
const Frame = ({ title, children }: { title: string; children: React.ReactNode }) => <YStack gap="$3" style={{ padding: 16 }}><H2 size="$6">{title}</H2>{children}</YStack>;

export function AudioPlayer({ component }: { component: AppComponent }) {
  const [uri, setUri] = useState<string | null>(null);
  const player = useAudioPlayer(uri, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  async function pick() { const picker = await import('expo-document-picker'); const result = await picker.getDocumentAsync({ type: 'audio/*' }); if (!result.canceled) setUri(result.assets[0].uri); }
  return <Frame title={component.title ?? 'Audio'}><XStack gap="$2"><Button onPress={() => void pick()}>Choose</Button><Button disabled={!uri} onPress={() => status.playing ? player.pause() : player.play()}>{status.playing ? 'Pause' : 'Play'}</Button><Button disabled={!uri} onPress={() => { player.loop = !player.loop; }}>Loop</Button></XStack></Frame>;
}

export function VideoPlayer({ component }: { component: AppComponent }) {
  const [uri, setUri] = useState<string | null>(text(component.props?.uri) || null);
  const player = useVideoPlayer(uri, (instance) => { instance.loop = Boolean(component.props?.loop); });
  async function pick() { const picker = await import('expo-document-picker'); const result = await picker.getDocumentAsync({ type: 'video/*' }); if (!result.canceled) { setUri(result.assets[0].uri); player.replace(result.assets[0].uri); } }
  return <Frame title={component.title ?? 'Video'}>{uri ? <VideoView player={player} style={{ width: '100%', height: 220 }} nativeControls /> : null}<Button onPress={() => void pick()}>Choose video</Button></Frame>;
}
