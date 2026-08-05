import { Pause, Play, RotateCcw } from 'lucide-react-native';
import { Parser } from 'expr-eval-fork';
import { useEffect, useMemo, useState } from 'react';
import { Image } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Button, H2, Input, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui';
import { JSONUIProvider, Renderer } from '@json-render/react-native';
import type { Spec } from '@json-render/core';
import { createMachine, getNextSnapshot } from 'xstate';

import type { AppComponent } from './schema';
import { AssetWidget } from './asset-widget';
import { AutomationRecordWidget } from './automation-record-widget';
import { CanvasRecordWidget } from './canvas-record-widget';
import { NativeCapability, supportsNativeWidget } from './capabilities';
import { GameRecordWidget } from './game-record-widget';
import { MessagingWidget } from './messaging-widget';
import { AudioPlayer, VideoPlayer } from './media-widgets';
import { RouteRecordWidget } from './route-record-widget';
import { ShowcaseWidget, showcaseWidgets } from './showcase-widgets';
import { chat } from './services';
import { supportsWidget } from './widget-support';
import { StandardWidget, standardWidgets } from './standard-widgets';
import { useAppStore } from './store';
import { usePackageTheme } from './theme';
import Storage from './storage';

type Props = { appId?: string; component: AppComponent; navigate?(target: string): void };
type Row = Record<string, unknown>;

const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === 'object') : [];

function Frame({ title, children }: { title?: string; children: React.ReactNode }) {
  const theme = usePackageTheme();
  return <YStack gap="$3" style={{ padding: 16, borderRadius: 8, backgroundColor: theme.surface, borderWidth: 1, borderColor: `${theme.accent}33` }}>{title ? <H2 size="$6" style={{ color: theme.ink }}>{title}</H2> : null}{children}</YStack>;
}

function DataTable({ component }: Props) {
  const props = component.props ?? {};
  const items = rows(props.items);
  const rawColumns = Array.isArray(props.columns) ? props.columns : [];
  const columns = rawColumns.map((column) => typeof column === 'string' ? { key: column, label: column } : column as Row)
    .filter((column) => text(column.key));
  return <Frame title={component.title ?? text(props.title)}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <YStack style={{ minWidth: Math.max(280, columns.length * 120) }}>
        <XStack style={{ borderBottomWidth: 1, borderColor: '#ccd1cd', paddingVertical: 8 }}>
          {columns.map((column) => <Text key={text(column.key)} width={120} fontWeight="700">{text(column.label, text(column.key))}</Text>)}
        </XStack>
        {items.map((item, index) => <XStack key={String(item.id ?? index)} style={{ paddingVertical: 8 }}>
          {columns.map((column) => <Text key={text(column.key)} width={120}>{String(item[text(column.key)] ?? '')}</Text>)}
        </XStack>)}
      </YStack>
    </ScrollView>
  </Frame>;
}

function JsonUi({ component, navigate }: Props) {
  const spec = component.props?.spec as Spec;
  const state = component.props?.state && typeof component.props.state === 'object' ? component.props.state as Record<string, unknown> : {};
  return <JSONUIProvider initialState={state} navigate={(target) => navigate?.(target)}>
    <Renderer spec={spec} />
  </JSONUIProvider>;
}

function Checklist({ component }: Props) {
  const initial = rows(component.props?.items).map((item) => ({ label: text(item.label), checked: Boolean(item.checked) }));
  const [items, setItems] = useState(initial);
  return <Frame title={component.title}>
    {items.map((item, index) => <Button key={`${item.label}-${index}`} style={{ justifyContent: 'flex-start' }} chromeless onPress={() => setItems((current) => current.map((row, at) => at === index ? { ...row, checked: !row.checked } : row))}>
      <Text fontSize="$6">{item.checked ? '✓' : '○'}</Text><Text textDecorationLine={item.checked ? 'line-through' : 'none'}>{item.label}</Text>
    </Button>)}
  </Frame>;
}

type TimerMode = 'idle' | 'running' | 'paused' | 'review' | 'complete';
type TimerSnapshot = { mode: TimerMode; duration: number; remaining: number; savedAt: number; deadline?: number };
const timerMachine = createMachine({
  initial: 'idle',
  states: {
    idle: { on: { START: 'running' } },
    running: { on: { PAUSE: 'paused', RESET: 'idle', EXPIRE: 'complete', UNCERTAIN: 'review' } },
    paused: { on: { START: 'running', RESET: 'idle' } },
    review: { on: { START: 'running', RESET: 'idle' } },
    complete: { on: { RESET: 'idle', START: 'running' } },
  },
});
export const nextTimerMode = (mode: TimerMode, event: string) =>
  String(getNextSnapshot(timerMachine, timerMachine.resolveState({ value: mode, context: {} }), { type: event }).value) as TimerMode;
export function reconcileTimer(snapshot: TimerSnapshot, now = Date.now()): TimerSnapshot {
  if (snapshot.mode !== 'running') return snapshot;
  if (now + 2000 < snapshot.savedAt) return { ...snapshot, mode: 'review', savedAt: now };
  const remaining = Math.max(0, Math.ceil(((snapshot.deadline ?? snapshot.savedAt + snapshot.remaining * 1000) - now) / 1000));
  return { ...snapshot, remaining, savedAt: now, mode: remaining ? 'running' : 'complete' };
}

function Timer({ appId = 'unknown', component }: Props) {
  const presets = rows(component.props?.presets).map((preset) => ({
    label: text(preset.label, `${Math.round(number(preset.durationSeconds) / 60)}m`),
    duration: Math.max(1, number(preset.durationSeconds)),
  })).filter((preset) => preset.duration > 0).slice(0, 8);
  const configured = number(component.props?.durationSeconds, number(component.props?.duration, 1500));
  const options = presets.length ? presets : [{ label: `${Math.round(configured / 60)}m`, duration: configured }];
  const [selected, setSelected] = useState(Math.max(0, options.findIndex((preset) => preset.duration === configured)));
  const duration = options[selected]?.duration ?? configured;
  const key = `utopia:${appId}:timer:${component.id ?? component.title ?? 'timer'}`;
  const [timer, setTimer] = useState<TimerSnapshot>({ mode: 'idle', duration, remaining: duration, savedAt: Date.now() });
  const [hydrated, setHydrated] = useState(false);
  const update = (mode: TimerMode, remaining = timer.remaining, nextDuration = duration) => setTimer({
    mode, duration: nextDuration, remaining, savedAt: Date.now(),
    deadline: mode === 'running' ? Date.now() + remaining * 1000 : undefined,
  });
  useEffect(() => { let active = true; Storage.getItem(key).then((raw) => {
    if (!raw) return;
    const restored = reconcileTimer(JSON.parse(raw) as TimerSnapshot);
    setSelected(Math.max(0, options.findIndex((preset) => preset.duration === restored.duration)));
    setTimer(restored);
  }).catch(() => {}).finally(() => active && setHydrated(true)); return () => { active = false; }; }, [key]);
  useEffect(() => { if (hydrated) void Storage.setItem(key, JSON.stringify(timer)); }, [hydrated, key, timer]);
  useEffect(() => {
    if (timer.mode !== 'running') return;
    const id = setInterval(() => setTimer((value) => reconcileTimer(value)), 1000);
    return () => clearInterval(id);
  }, [timer.mode]);
  const remaining = timer.remaining;
  const running = timer.mode === 'running';
  const minutes = Math.floor(remaining / 60).toString().padStart(2, '0');
  const seconds = (remaining % 60).toString().padStart(2, '0');
  const size = 220;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = timer.duration ? Math.max(0, Math.min(1, remaining / timer.duration)) : 0;
  return <Frame title={component.title ?? text(component.props?.title)}>
    <YStack gap="$4" style={{ alignItems: 'center' }}>
      {options.length > 1 ? <XStack gap="$2" flexWrap="wrap" accessibilityRole="radiogroup">{options.map((preset, index) =>
        <Button key={`${preset.label}-${preset.duration}`} size="$3" theme={selected === index ? 'green' : undefined}
          accessibilityRole="radio" accessibilityState={{ selected: selected === index }}
          onPress={() => { setSelected(index); update('idle', preset.duration, preset.duration); }}>{preset.label}</Button>)}</XStack> : null}
      <YStack width={size} height={size} style={{ alignItems: 'center', justifyContent: 'center' }} accessibilityRole="timer" accessibilityLabel={`${minutes}:${seconds} remaining`}>
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          <Circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke="#D9DFDA" strokeWidth={stroke} />
          <Circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke="#2F7448" strokeWidth={stroke}
            strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress)}
            strokeLinecap="round" rotation="-90" origin={`${size / 2}, ${size / 2}`} />
        </Svg>
        <H2 fontSize={52}>{minutes}:{seconds}</H2>
      </YStack>
      {timer.mode === 'review' ? <Paragraph accessibilityRole="alert">Clock changed. Confirm to continue.</Paragraph> : null}
      <XStack gap="$3">
        <Button circular size="$5" icon={running ? Pause : Play} onPress={() => update(nextTimerMode(timer.mode, running ? 'PAUSE' : 'START'), timer.mode === 'complete' ? duration : remaining)} aria-label={running ? 'Pause' : timer.mode === 'review' ? 'Confirm and continue' : 'Start'} />
        <Button circular size="$5" icon={RotateCcw} onPress={() => update('idle', duration)} aria-label="Reset" />
      </XStack>
    </YStack>
  </Frame>;
}

function StepFlow({ appId, component }: Props) {
  const steps = rows(component.props?.steps);
  const [active, setActive] = useState(0);
  const step = steps[active] ?? {};
  return <Frame title={component.title}>
    <XStack flexWrap="wrap" gap="$2">{steps.map((item, index) => <Button key={text(item.id, String(index))} size="$3" theme={index === active ? 'green' : undefined} onPress={() => setActive(index)}>{text(item.title, `Step ${index + 1}`)}</Button>)}</XStack>
    <Timer appId={appId} component={{ ...component, id: `${component.id ?? 'step'}-${active}`, title: text(step.title), props: { durationSeconds: number(step.durationSeconds, 60) }, kind: 'widget' }} />
  </Frame>;
}

function Calculator({ component }: Props) {
  const [expression, setExpression] = useState('');
  const [answer, setAnswer] = useState('0');
  const [angle, setAngle] = useState<'deg' | 'rad'>('deg');
  const [memory, setMemory] = useState(0);
  const keys = ['MC','MR','M+','M-','sin(','cos(','tan(','sqrt(','ln(','log10(','^','!','7','8','9','/','4','5','6','*','1','2','3','-','0','.','pi','+','(',')','DEL','='];
  const evaluate = () => {
    const parser = new Parser();
    const radians = (value: number) => angle === 'deg' ? value * Math.PI / 180 : value;
    parser.functions.sin = (value: number) => Math.sin(radians(value));
    parser.functions.cos = (value: number) => Math.cos(radians(value));
    parser.functions.tan = (value: number) => Math.tan(radians(value));
    return parser.evaluate(expression || answer, { pi: Math.PI, e: Math.E, M: memory });
  };
  const solve = () => {
    try { const value = Number(evaluate().toPrecision(12)); setAnswer(String(value)); setExpression(String(value)); } catch { setAnswer('Error'); }
  };
  const press = (key: string) => {
    if (key === '=') return solve();
    if (key === 'DEL') return setExpression((value) => value.slice(0, -1));
    if (key === 'MC') return setMemory(0);
    if (key === 'MR') return setExpression((value) => `${value}M`);
    if (key === 'M+' || key === 'M-') {
      try { const value = evaluate(); setMemory((current) => key === 'M+' ? current + value : current - value); } catch { setAnswer('Error'); }
      return;
    }
    setExpression((value) => value + key);
  };
  return <Frame title={component.title}>
    <YStack gap="$2" style={{ alignItems: 'flex-end' }}><Paragraph color="$color10">{expression || '0'}</Paragraph><H2 fontSize={44}>{answer}</H2></YStack>
    <XStack gap="$2"><Button flex={1} theme={angle === 'deg' ? 'green' : undefined} onPress={() => setAngle('deg')}>deg</Button><Button flex={1} theme={angle === 'rad' ? 'green' : undefined} onPress={() => setAngle('rad')}>rad</Button><Button flex={1} onPress={() => { setExpression(''); setAnswer('0'); }}>AC</Button></XStack>
    <XStack flexWrap="wrap" gap="$2">{keys.map((key) => <Button key={key} style={{ width: '22%', minWidth: 52 }} theme={key === '=' ? 'green' : undefined} onPress={() => press(key)}>{key}</Button>)}</XStack>
    <Paragraph color="$color10">M {Number(memory.toPrecision(12))}</Paragraph>
  </Frame>;
}

function Form({ component }: Props) {
  const [value, setValue] = useState('');
  return <Frame title={component.title ?? text(component.props?.title)}><Input value={value} onChangeText={setValue} placeholder={text(component.props?.placeholder, 'Enter value')} /><Button disabled={!value.trim()} onPress={() => setValue('')}>{text(component.props?.cta, 'Save')}</Button></Frame>;
}

function Content({ component }: Props) {
  const props = component.props ?? {};
  const items = rows(props.items ?? props.rows ?? props.cards);
  const image = text(props.imageUrl, text(props.image));
  return <Frame title={component.title ?? text(props.title)}>
    {image ? <Image source={{ uri: image }} style={{ width: '100%', height: 180, borderRadius: 8 }} resizeMode="cover" /> : null}
    {items.slice(0, 12).map((item, index) => <XStack key={String(item.id ?? index)} gap="$2" style={{ alignItems: 'center' }}><Text fontSize="$6">{text(item.icon, text(item.emoji))}</Text><YStack flex={1}><Text fontWeight="700">{text(item.title, text(item.label, text(item.name)))}</Text>{item.value != null ? <Text color="$color10">{String(item.value)}</Text> : null}</YStack></XStack>)}
    {!image && !items.length ? <Paragraph color="$color10">No content</Paragraph> : null}
  </Frame>;
}

function Chat({ component }: Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [busy, setBusy] = useState(false);
  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next); setInput(''); setBusy(true);
    try { const result = await chat(text(component.props?.endpoint, 'http://localhost:8787/chat'), next); setMessages([...next, { role: 'assistant', content: result.text }]); }
    catch (cause) { setMessages([...next, { role: 'assistant', content: cause instanceof Error ? cause.message : 'Failed' }]); }
    finally { setBusy(false); }
  }
  return <Frame title={component.title ?? 'Chat'}>{messages.map((message, index) => <Paragraph key={index} style={{ alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start' }}>{message.content}</Paragraph>)}<XStack gap="$2"><Input flex={1} value={input} onChangeText={setInput} onSubmitEditing={() => void send()} placeholder="Message" /><Button disabled={busy || !input.trim()} onPress={() => void send()}>Send</Button></XStack></Frame>;
}

export function Widget({ appId = 'unknown', component, navigate = () => {} }: Props) {
  const runtime = useAppStore();
  return useMemo(() => {
    if (!supportsWidget(component.widget)) throw new Error(`Unsupported widget kind ${String(component.widget)}`);
    if (supportsNativeWidget(component.widget)) return <NativeCapability appId={appId} component={component} />;
    if (showcaseWidgets.has(component.widget ?? '')) return <ShowcaseWidget component={component} navigate={navigate} />;
    if (standardWidgets.has(component.widget ?? '')) return <StandardWidget component={component} navigate={navigate} />;
    switch (component.widget) {
      case 'assistantChat': return <Chat component={component} />;
      case 'audioLoopPlayer': return <AudioPlayer component={component} />;
      case 'videoPlayer': return <VideoPlayer component={component} />;
      case 'dataTable': return <DataTable component={component} />;
      case 'assetBlock': return <AssetWidget source={component.props?.source} alt={component.title} />;
      case 'messageThread': return <MessagingWidget component={component} runtime={runtime} />;
      case 'canvasBoard': return <CanvasRecordWidget component={component} runtime={runtime} />;
      case 'automationFlow': return <AutomationRecordWidget component={component} runtime={runtime} />;
      case 'routePlanner': return <RouteRecordWidget component={component} runtime={runtime} />;
      case 'gameSession': return <GameRecordWidget component={component} runtime={runtime} />;
      case 'jsonUi': return <JsonUi component={component} navigate={navigate} />;
      case 'checklistCard': return <Checklist component={component} />;
      case 'durationTimer': return <Timer appId={appId} component={component} />;
      case 'stepFlow': return <StepFlow appId={appId} component={component} />;
      case 'scientificCalculator': return <Calculator component={component} />;
      case 'formCard': case 'smartCapture': return <Form component={component} />;
      default: throw new Error(`Unsupported widget kind ${String(component.widget)}`);
    }
  }, [appId, component, navigate, runtime]);
}
