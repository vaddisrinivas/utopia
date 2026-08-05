import { Archive, CheckCircle2, ChevronRight, Download, Search, Settings } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, useWindowDimensions } from 'react-native';
import { Button, H1, Input, Paragraph, XStack, YStack } from 'tamagui';

import { catalog } from '@/src/kernel/catalog';
import { installWithInstallationId, loadRegistry, trustPublisher, type RegistryEntry } from '@/src/kernel/registry';

export default function AppLauncher() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const columns = width >= 1120 ? 3 : width >= 720 ? 2 : 1;
  const [settings, setSettings] = useState(false);
  const [url, setUrl] = useState('');
  const [publisher, setPublisher] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [remote, setRemote] = useState<RegistryEntry[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'active' | 'inactive'>('active');
  const activeCount = catalog.filter((pkg) => pkg.catalog.status === 'active').length;
  const inactiveCount = catalog.length - activeCount;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((pkg) => pkg.catalog.status === scope)
      .filter((pkg) => !needle || `${pkg.presentation.label} ${pkg.id}`.toLowerCase().includes(needle));
  }, [query, scope]);
  async function connect() {
    setError('');
    try { setRemote(await loadRegistry(url)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Registry failed'); }
  }
  const header = <YStack gap="$4">
      <XStack style={{ alignItems: 'center', justifyContent: 'space-between' }}><YStack><H1 size="$9" color="#182019">Apps</H1><Paragraph color="#657066">{activeCount} active · {inactiveCount} inactive</Paragraph></YStack><Button circular chromeless icon={<Settings color="#47524A" />} onPress={() => setSettings((value) => !value)} aria-label="Catalog settings" /></XStack>
      <XStack gap="$2"><Button flex={1} icon={CheckCircle2} theme={scope === 'active' ? 'green' : undefined} onPress={() => setScope('active')}>Active {activeCount}</Button><Button flex={1} icon={Archive} theme={scope === 'inactive' ? 'orange' : undefined} onPress={() => setScope('inactive')}>Inactive {inactiveCount}</Button></XStack>
      <XStack gap="$2" style={{ alignItems: 'center' }}><Search size={20} color="#657066" /><Input flex={1} value={query} onChangeText={setQuery} placeholder={`Search ${scope}`} placeholderTextColor="$gray10" autoCapitalize="none" style={{ minHeight: 48, color: '#182019', backgroundColor: '#FFFFFF', borderColor: '#C9D1CB' }} /></XStack>
      {settings ? <YStack gap="$2">
        <Input value={url} onChangeText={setUrl} placeholder="Catalog URL" autoCapitalize="none" />
        <Button disabled={!url.trim()} onPress={() => void connect()}>Connect</Button>
        <Input value={publisher} onChangeText={setPublisher} placeholder="Publisher" autoCapitalize="none" />
        <Input value={publicKey} onChangeText={setPublicKey} placeholder="Publisher key" autoCapitalize="none" />
        <Button disabled={!publisher.trim() || !publicKey.trim()} onPress={() => void trustPublisher(publisher.trim(), publicKey.trim()).then(() => { setPublisher(''); setPublicKey(''); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Invalid key'))}>Trust</Button>
        {error ? <Paragraph color="$red10">{error}</Paragraph> : null}
      </YStack> : null}
      {remote.map((entry) => <Button key={entry.id} size="$5" icon={Download} onPress={async () => {
        setError('');
        try {
          const { installationId } = await installWithInstallationId(entry);
          router.push(`/apps/${installationId}`);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Install failed'); }
      }}>{entry.id}</Button>)}
    </YStack>;
  return <FlatList
    key={columns}
    data={visible}
    numColumns={columns}
    keyExtractor={(pkg) => pkg.id}
    initialNumToRender={12}
    maxToRenderPerBatch={12}
    windowSize={7}
    style={{ backgroundColor: '#F4F6F3' }}
    contentContainerStyle={{ width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 18, paddingTop: 32 }}
    columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
    ListHeaderComponent={header}
    ListHeaderComponentStyle={{ marginBottom: 16 }}
    renderItem={({ item: pkg }) => {
      const visual = pkg.presentation.visualIdentity;
      const accent = visual?.accent ?? '#2F7448';
      const inkValue = (visual as Record<string, unknown> | undefined)?.ink;
      const ink = typeof inkValue === 'string' ? inkValue : '#182019';
      return <Button unstyled height={76} flex={1} style={{ marginBottom: 12, paddingHorizontal: 14, borderRadius: 8, backgroundColor: visual?.canvas ?? '#FFFFFF', borderWidth: 1, borderColor: `${accent}66`, justifyContent: 'flex-start' }} onPress={() => router.push(`/apps/${pkg.id}`)} aria-label={`Open ${pkg.presentation.label}`}>
        <XStack flex={1} width="100%" gap="$3" style={{ alignItems: 'center' }}><YStack style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: accent }}><Paragraph color="#FFFFFF" fontSize="$6" fontWeight="900">{visual?.emoji ?? pkg.presentation.label.slice(0, 1).toUpperCase()}</Paragraph></YStack><YStack flex={1}><Paragraph style={{ color: ink, textAlign: 'left' }} fontWeight="800" numberOfLines={2}>{pkg.presentation.label}</Paragraph>{pkg.catalog.status === 'inactive' ? <Paragraph size="$2" color="#657066">Similar to {pkg.catalog.duplicateOf} · {Math.round(pkg.catalog.similarity * 100)}%</Paragraph> : null}</YStack><ChevronRight size={20} color={accent} /></XStack>
      </Button>;
    }}
  />;
}
