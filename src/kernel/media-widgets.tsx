import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Button, H2, Text, XStack, YStack } from 'tamagui';

import type { AppComponent } from './schema';

const text = (value: unknown) => typeof value === 'string' ? value : '';
const Frame = ({ title, children }: { title: string; children: React.ReactNode }) => <YStack gap="$3" style={{ padding: 16 }}><H2 size="$6">{title}</H2>{children}</YStack>;

export function AudioPlayer({ component }: { component: AppComponent }) {
  const [uri, setUri] = useState<string | null>(null);
  const player = useAudioPlayer(uri, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  async function pick() { const picker = await import('expo-document-picker'); const result = await picker.getDocumentAsync({ type: 'audio/*' }); if (!result.canceled) setUri(result.assets[0].uri); }
  const loopState = status.loop ? 'on' : 'off';
  const playbackState = !uri ? 'No track selected' : status.playing ? 'Playing' : 'Paused';
  return <Frame title={component.title ?? 'Audio'}>
    <XStack accessibilityLiveRegion="polite"><Text>{`${playbackState} • Loop ${loopState}`}{uri ? ' • Track selected' : ''}</Text></XStack>
    <XStack gap="$2">
      <Button accessibilityRole="button" accessibilityLabel="Choose audio file" onPress={() => void pick()}>Choose</Button>
      <Button accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause audio playback' : 'Play audio'} disabled={!uri} accessibilityState={{ disabled: !uri }} onPress={() => status.playing ? player.pause() : player.play()}>{status.playing ? 'Pause' : 'Play'}</Button>
      <Button accessibilityRole="button" accessibilityLabel={status.loop ? 'Disable loop' : 'Enable loop'} disabled={!uri} accessibilityState={{ selected: status.loop, disabled: !uri }} onPress={() => { player.loop = !player.loop; }}>Loop</Button>
    </XStack>
  </Frame>;
}

export function VideoPlayer({ component }: { component: AppComponent }) {
  const [uri, setUri] = useState<string | null>(text(component.props?.uri) || null);
  const [loop, setLoop] = useState(Boolean(component.props?.loop));
  const player = useVideoPlayer(uri, (instance) => { instance.loop = loop; });
  useEffect(() => { player.loop = loop; }, [loop, player]);
  async function pick() { const picker = await import('expo-document-picker'); const result = await picker.getDocumentAsync({ type: 'video/*' }); if (!result.canceled) { setUri(result.assets[0].uri); player.replace(result.assets[0].uri); } }
  const status = !uri ? 'No video selected' : `Video ${loop ? 'looping' : 'not looping'}`;
  return <Frame title={component.title ?? 'Video'}>
    {uri ? <VideoView player={player} style={{ width: '100%', height: 220 }} nativeControls /> : null}
    <XStack accessibilityLiveRegion="polite"><Text>{status}</Text></XStack>
    <XStack gap="$2">
      <Button accessibilityRole="button" accessibilityLabel="Choose video file" onPress={() => void pick()}>Choose video</Button>
      <Button accessibilityRole="button" accessibilityLabel={loop ? 'Disable loop' : 'Enable loop'} accessibilityState={{ selected: loop }} disabled={!uri} onPress={() => setLoop((value) => !value)}>Loop</Button>
    </XStack>
  </Frame>;
}
