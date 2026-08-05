import { ArrowLeft, ArrowRight, Play, Pause } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Button, H2, Text, XStack, YStack } from 'tamagui';

import type { AppComponent } from './schema';

type MediaKind = 'audio' | 'video';

type MediaEntry = {
  id: string;
  kind: MediaKind;
  title: string;
  description?: string;
  uri: string;
  loop: boolean;
};

const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const bool = (value: unknown, fallback = false) => typeof value === 'boolean' ? value : fallback;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function collectFromProps(component: AppComponent): MediaEntry[] {
  const props = component.props ?? {};
  const single = text(props.uri) || text(props.source);
  const kind = props.kind === 'video' ? 'video' : 'audio';

  if (single) {
    return [{
      id: component.id ?? 'media-item',
      kind,
      title: text(props.title, component.title ?? 'Media item'),
      description: text(props.description),
      uri: single,
      loop: bool(props.loop, false),
    }];
  }

  const items = list(props.items).map((item, index): MediaEntry | null => {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    return {
      id: text(record.id, `${index}`),
      kind: text(record.kind) === 'video' ? 'video' : kind,
      title: text(record.title, text(record.name, `Media ${index + 1}`)),
      description: text(record.description),
      uri: text(record.uri),
      loop: bool(record.loop, bool(props.loop)),
    };
  });

  return items.reduce<MediaEntry[]>((acc, entry) => {
    if (entry?.uri) acc.push(entry);
    return acc;
  }, []);
}

export function createMediaManifest(component: AppComponent): MediaEntry[] {
  return collectFromProps(component);
}

export function AudioPlayer({ component }: { component: AppComponent }) {
  const [items] = useState(() => collectFromProps(component));
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(() => items[0]?.loop ?? false);
  const sorted = useMemo(() => items, [items]);
  const current = sorted[index] ?? sorted[0];
  if (!current) return <H2 size="$6">No media configured</H2>;

  const next = () => setIndex((nextIndex) => (nextIndex + 1) % sorted.length);
  const prev = () => setIndex((nextIndex) => (nextIndex - 1 + sorted.length) % sorted.length);

  return <YStack gap="$3" style={{ padding: 16 }}>
    <H2 size="$6">{text(component.title, 'Media')}</H2>
    <YStack gap="$2" style={{ padding: 12, borderWidth: 1, borderRadius: 8, borderColor: '#cfd8dc', backgroundColor: '#f7fbff' }}>
      <Text fontWeight="700">{current.kind.toUpperCase()} · {current.title}</Text>
      {current.description ? <Text color="$color10">{current.description}</Text> : null}
      <Text color="$color10" fontSize="$2" selectable>{current.uri}</Text>
      <XStack gap="$2">
        <Button size="$3" onPress={prev}><ArrowLeft size={14} /> Prev</Button>
        <Button size="$3" onPress={() => setPlaying((value) => !value)}>{playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Play'}</Button>
        <Button size="$3" onPress={next}><ArrowRight size={14} /> Next</Button>
      </XStack>
      <Button size="$2" onPress={() => setLoop((value) => !value)}>{loop ? 'Loop: on' : 'Loop: off'}</Button>
      <Text color="$color10" fontSize="$2">No native playback in this shell; controls model local state only.</Text>
    </YStack>
  </YStack>;
}

export function VideoPlayer({ component }: { component: AppComponent }) {
  return <AudioPlayer component={component} />;
}
