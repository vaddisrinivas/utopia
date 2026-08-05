import { Check, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button, Input, Label, Paragraph, ScrollView, Switch, Text, XStack, YStack } from 'tamagui';

import type { AppAction, AppPackage } from './schema';
import { exportAppData } from './export';
import { useAppStore } from './store';
import { usePackageTheme } from './theme';

type Props = { action: AppAction; pkg: AppPackage; navigate(target: string): boolean };
type Values = Record<string, unknown>;
const words = (value: string) => value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export function Proposal({ action, pkg, navigate }: Props) {
  const { dispatch, state, sync } = useAppStore();
  const theme = usePackageTheme();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [recordId, setRecordId] = useState('');
  const [error, setError] = useState('');
  const collection = action.collection ?? String(action.payload?.collection ?? '');
  const spec = pkg.collections[collection];
  const records = useMemo(() => state.records.filter((record) => record.collection === collection), [collection, state.records]);
  const operation = action.operation ?? 'unsupported';
  const label = action.label ?? words(operation);
  const run = async () => {
    setError('');
    try {
      if (operation === 'navigate') {
        await dispatch({ ...action, payload: { ...action.payload, confirmed: true } });
        navigate(action.target ?? String(action.payload?.route ?? ''));
        setOpen(false);
        return;
      }
      if (operation === 'export') await exportAppData(pkg, state);
      if (operation === 'retry') {
        const endpoint = String(action.payload?.endpoint ?? process.env.EXPO_PUBLIC_UTOPIA_SERVER_URL ?? '');
        if (!endpoint) throw new Error('Sync server is not configured');
        await sync(pkg, endpoint, String(action.payload?.dataHome ?? pkg.defaultDataHome));
      }
      await dispatch({ ...action, collection, recordId, values, payload: { ...action.payload, confirmed: true } });
      setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed'); }
  };
  const selectable = ['update', 'archive', 'restore', 'delete'].includes(operation);
  const unavailable = operation === 'unsupported';
  return <>
    <Button style={{ alignSelf: 'flex-start', backgroundColor: theme.accent }} color="#FFFFFF" onPress={() => setOpen(true)}>{label}</Button>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.frame}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        <YStack width="90%" gap="$3" style={{ maxWidth: 520, padding: 16, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.accent }}>
      <XStack style={{ alignItems: 'center', justifyContent: 'space-between' }}><Text fontSize="$6" fontWeight="700">{label}</Text><Button circular chromeless icon={X} aria-label="Close" onPress={() => setOpen(false)} /></XStack>
      {unavailable ? <Paragraph color="$red10">Action unavailable.</Paragraph> : null}
      {error ? <Paragraph color="$red10">{error}</Paragraph> : null}
      {selectable ? <ScrollView style={{ maxHeight: 180 }}><YStack gap="$2">{records.map((record) =>
        <Button key={record.id} style={{ backgroundColor: record.id === recordId ? '#DDECE3' : undefined }} onPress={() => setRecordId(record.id)}>
          {String(record.values.title ?? record.values.name ?? record.values.label ?? record.id)}
        </Button>)}</YStack></ScrollView> : null}
      {['create', 'update'].includes(operation) ? <YStack gap="$2">{Object.entries(spec?.fields ?? {}).filter(([id]) => !['id', 'createdAt', 'updatedAt'].includes(id)).map(([id, field]) =>
        field.type === 'boolean'
          ? <XStack key={id} style={{ alignItems: 'center', justifyContent: 'space-between' }}><Label htmlFor={`proposal-${id}`}>{words(id)}</Label><Switch id={`proposal-${id}`} checked={Boolean(values[id])} onCheckedChange={(value) => setValues((current) => ({ ...current, [id]: value }))}><Switch.Thumb /></Switch></XStack>
          : <Input key={id} aria-label={words(id)} placeholder={words(id)} keyboardType={field.type === 'number' ? 'numeric' : 'default'} onChangeText={(value) => setValues((current) => ({ ...current, [id]: field.type === 'number' ? Number(value) : value }))} />)}</YStack> : null}
      <Button icon={Check} disabled={unavailable || (selectable && !recordId)} onPress={() => void run()}>Confirm</Button>
        </YStack>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0008' },
});
