import { ChevronRight, Minus, Pause, Play, Plus, RotateCcw, Trophy, Undo2, Redo2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Button, H2, Progress, ScrollView, Text, XStack, YStack } from 'tamagui';
import { z } from 'zod';

import type { AppComponent } from './schema';

const Id = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
const Name = z.string().trim().min(1).max(64);
const Color = z.string().regex(/^#[0-9a-f]{6}$/i);

const PlayerSchema = z.object({
  id: Id,
  name: Name,
  emoji: z.string().trim().max(4).optional(),
  color: Color.optional(),
  teamId: Id.optional(),
}).strict();

const TeamSchema = z.object({
  id: Id,
  name: Name,
  emoji: z.string().trim().max(4).optional(),
  color: Color.optional(),
}).strict();

const WinSchema = z.object({
  kind: z.enum(['score', 'rounds']).default('score'),
  target: z.number().int().min(1).max(100000).default(10),
}).strict();

export const GameSnapshotSchema = z.object({
  schemaVersion: z.literal('utopia.game-session.v3'),
  round: z.number().int().min(1).max(10000),
  turnIndex: z.number().int().min(0).max(31),
  scores: z.record(Id, z.number().int().min(-100000).max(100000)),
  timerRemaining: z.number().int().min(0).max(86400),
  completed: z.boolean(),
  winnerId: Id.optional(),
}).strict();

export const GameConfigSchema = z.object({
  schemaVersion: z.literal('utopia.game.v3'),
  title: Name.default('Game'),
  emoji: z.string().trim().max(4).default('🎮'),
  accent: Color.default('#18794e'),
  canvas: Color.default('#f7f5ef'),
  players: z.array(PlayerSchema).min(1).max(32),
  teams: z.array(TeamSchema).max(16).default([]),
  rounds: z.number().int().min(1).max(10000).default(1),
  turnSeconds: z.number().int().min(0).max(86400).default(0),
  scoreStep: z.number().int().min(1).max(1000).default(1),
  win: WinSchema.default({ kind: 'score', target: 10 }),
  snapshot: GameSnapshotSchema.optional(),
}).strict().superRefine((config, context) => {
  const players = new Set<string>();
  for (const player of config.players) {
    if (players.has(player.id)) context.addIssue({ code: 'custom', path: ['players'], message: `duplicate player ${player.id}` });
    players.add(player.id);
    if (player.teamId && !config.teams.some((team) => team.id === player.teamId)) {
      context.addIssue({ code: 'custom', path: ['players'], message: `unknown team ${player.teamId}` });
    }
  }
  const teams = new Set<string>();
  for (const team of config.teams) {
    if (teams.has(team.id)) context.addIssue({ code: 'custom', path: ['teams'], message: `duplicate team ${team.id}` });
    teams.add(team.id);
  }
  if (config.snapshot && Object.keys(config.snapshot.scores).some((id) => !players.has(id))) {
    context.addIssue({ code: 'custom', path: ['snapshot'], message: 'snapshot contains an unknown player' });
  }
});

export type GameConfig = z.infer<typeof GameConfigSchema>;
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;
export type GameSession = GameSnapshot;
export type GameAction =
  | { kind: 'score'; playerId: string; delta: number }
  | { kind: 'nextTurn' }
  | { kind: 'reset' };
export type GameHistory = { past: GameSession[]; present: GameSession; future: GameSession[] };

export function parseGameConfig(value: unknown): GameConfig {
  return GameConfigSchema.parse(value);
}

export function parseGameSnapshot(value: unknown): GameSnapshot {
  return GameSnapshotSchema.parse(value);
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function scoreMap(config: GameConfig, scores?: Record<string, number>) {
  return Object.fromEntries(config.players.map((player) => [player.id, scores?.[player.id] ?? 0]));
}

export function createGameSession(config: GameConfig, snapshot = config.snapshot): GameSession {
  const candidate = snapshot ? parseGameSnapshot(snapshot) : undefined;
  const scores = scoreMap(config, candidate?.scores);
  return {
    schemaVersion: 'utopia.game-session.v3',
    round: candidate?.round ?? 1,
    turnIndex: Math.min(candidate?.turnIndex ?? 0, config.players.length - 1),
    scores,
    timerRemaining: candidate?.timerRemaining ?? config.turnSeconds,
    completed: candidate?.completed ?? false,
    winnerId: candidate?.winnerId,
  };
}

function teamScore(session: GameSession, config: GameConfig, teamId: string) {
  return config.players.filter((player) => player.teamId === teamId).reduce((total, player) => total + (session.scores[player.id] ?? 0), 0);
}

function winnerFor(session: GameSession, config: GameConfig): string | undefined {
  if (config.teams.length) {
    return config.teams.find((team) => teamScore(session, config, team.id) >= config.win.target)?.id;
  }
  return config.players.find((player) => (session.scores[player.id] ?? 0) >= config.win.target)?.id;
}

function roundWinner(session: GameSession, config: GameConfig): string | undefined {
  if (config.teams.length) {
    return config.teams.reduce<GameConfig['teams'][number] | undefined>((best, team) => !best || teamScore(session, config, team.id) > teamScore(session, config, best.id) ? team : best, undefined)?.id;
  }
  return config.players.reduce<GameConfig['players'][number] | undefined>((best, player) => !best || (session.scores[player.id] ?? 0) > (session.scores[best.id] ?? 0) ? player : best, undefined)?.id;
}

export function autoAdvanceGameTurn(session: GameSession, config: GameConfig, timer: number, running: boolean): GameSession | null {
  if (!running || timer !== 0 || session.completed) return null;
  return applyGameAction(session, config, { kind: 'nextTurn' });
}

export function applyGameAction(session: GameSession, config: GameConfig, action: GameAction): GameSession {
  if (action.kind === 'reset') return createGameSession(config);
  if (session.completed) return session;
  if (action.kind === 'score') {
    if (!config.players.some((player) => player.id === action.playerId)) return session;
    const delta = Math.max(-1000, Math.min(1000, Math.trunc(action.delta)));
    const next = { ...session, scores: { ...session.scores, [action.playerId]: (session.scores[action.playerId] ?? 0) + delta } };
    const winner = config.win.kind === 'score' ? winnerFor(next, config) : undefined;
    return winner ? { ...next, completed: true, winnerId: winner } : next;
  }
  const nextIndex = session.turnIndex + 1;
  if (nextIndex < config.players.length) return { ...session, turnIndex: nextIndex };
  if (session.round < config.rounds) return { ...session, round: session.round + 1, turnIndex: 0 };
  return { ...session, completed: true, winnerId: config.win.kind === 'rounds' ? roundWinner(session, config) : winnerFor(session, config) };
}

export function createGameHistory(session: GameSession): GameHistory {
  return { past: [], present: copy(session), future: [] };
}

export function commitGameHistory(history: GameHistory, session: GameSession): GameHistory {
  return { past: [...history.past, history.present].slice(-100), present: copy(session), future: [] };
}

export function undoGameHistory(history: GameHistory): GameHistory {
  const previous = history.past.at(-1);
  return previous ? { past: history.past.slice(0, -1), present: copy(previous), future: [history.present, ...history.future] } : history;
}

export function redoGameHistory(history: GameHistory): GameHistory {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present].slice(-100), present: copy(next), future: history.future.slice(1) } : history;
}

export function exportGameSnapshot(session: GameSession, timerRemaining = session.timerRemaining): string {
  return JSON.stringify(GameSnapshotSchema.parse({ ...session, timerRemaining }));
}

function label(config: GameConfig, id: string) {
  return config.players.find((player) => player.id === id)?.name ?? config.teams.find((team) => team.id === id)?.name ?? id;
}

function GameError({ message }: { message: string }) {
  return <YStack gap="$2" style={{ padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#b42318', backgroundColor: '#fff4f2' }}><Text color="$red10" accessibilityRole="alert">Invalid game configuration</Text><Text color="$red10">{message}</Text></YStack>;
}

export function GameWidget({ component, onChange }: { component: AppComponent; onChange?(session: GameSession): void }) {
  const parsed = useMemo(() => GameConfigSchema.safeParse(component.props?.config ?? component.props), [component.props]);
  if (!parsed.success) return <GameError message={parsed.error.issues[0]?.message ?? 'Check the V3 game config'} />;
  return <ParsedGame config={parsed.data} onChange={onChange} />;
}

function ParsedGame({ config, onChange }: { config: GameConfig; onChange?(session: GameSession): void }) {
  const initial = useMemo(() => createGameSession(config), [config]);
  const [history, setHistory] = useState(() => createGameHistory(initial));
  const [timer, setTimer] = useState(initial.timerRemaining);
  const [running, setRunning] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const session = history.present;
  const active = config.players[session.turnIndex];
  const progress = config.win.kind === 'score' ? Math.min(100, Math.max(...Object.values(session.scores), 0) / config.win.target * 100) : session.round / config.rounds * 100;

  useEffect(() => {
    if (!running || timer <= 0) return;
    const id = setInterval(() => setTimer((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(id);
  }, [running, timer]);
  useEffect(() => {
    const next = autoAdvanceGameTurn(session, config, timer, running);
    if (!next) return;
    setHistory((current) => commitGameHistory(current, next));
    onChange?.(next);
    if (next.completed) {
      setRunning(false);
      setTimer(0);
    } else {
      setRunning(true);
      setTimer(config.turnSeconds);
    }
  }, [config, running, session, timer, onChange]);

  const commit = (next: GameSession, resetTimer = false) => {
    setHistory((current) => commitGameHistory(current, next));
    onChange?.(next);
    if (resetTimer) { setRunning(false); setTimer(config.turnSeconds); }
  };
  const score = (playerId: string, delta: number) => commit(applyGameAction(session, config, { kind: 'score', playerId, delta }));
  const turn = () => commit(applyGameAction(session, config, { kind: 'nextTurn' }), true);
  const reset = () => { const next = applyGameAction(session, config, { kind: 'reset' }); setHistory(createGameHistory(next)); onChange?.(next); setTimer(config.turnSeconds); setRunning(false); setSnapshot(''); };
  const undo = () => setHistory((current) => { const next = undoGameHistory(current); onChange?.(next.present); return next; });
  const redo = () => setHistory((current) => { const next = redoGameHistory(current); onChange?.(next.present); return next; });
  const exportSnapshot = () => setSnapshot(exportGameSnapshot(session, timer));
  const restore = () => { try { const restored = parseGameSnapshot(JSON.parse(snapshot)); const next = createGameSession(config, restored); setHistory(createGameHistory(next)); onChange?.(next); setTimer(restored.timerRemaining); setRunning(false); } catch { setSnapshot(''); } };
  const minutes = Math.floor(timer / 60).toString().padStart(2, '0');
  const seconds = (timer % 60).toString().padStart(2, '0');

  return <YStack flex={1} gap="$3" style={{ padding: 16, backgroundColor: config.canvas }}>
    <XStack style={{ alignItems: 'center', justifyContent: 'space-between' }}><XStack gap="$2" style={{ alignItems: 'center' }}><Text fontSize="$8">{config.emoji}</Text><YStack><Text fontSize="$7" fontWeight="800">{config.title}</Text><Text color="$color10">Local session · Round {session.round}/{config.rounds}</Text></YStack></XStack><Trophy size={24} color={config.accent} /></XStack>
    <Progress value={progress} background={`${config.accent}22`} aria-label="Game progress"><Progress.Indicator background={config.accent} /></Progress>
    <ScrollView contentContainerStyle={{ gap: 10 }}>
      {config.teams.length ? <Text fontWeight="700">Teams</Text> : null}
      {config.teams.map((team) => <YStack key={team.id} gap="$1" style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: `${team.color ?? config.accent}55`, backgroundColor: '#ffffffaa' }}><Text fontWeight="800">{team.emoji ?? '👥'} {team.name} · {teamScore(session, config, team.id)}</Text><Text color="$color10">{config.players.filter((player) => player.teamId === team.id).map((player) => player.name).join(', ') || 'No players'}</Text></YStack>)}
      <Text fontWeight="700">Players</Text>
      {config.players.map((player) => <XStack key={player.id} gap="$2" style={{ alignItems: 'center', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: player.id === active?.id ? config.accent : '#d7ddd8', backgroundColor: '#ffffffcc' }}><Text fontSize="$6">{player.emoji ?? '🙂'}</Text><YStack flex={1}><Text fontWeight="800">{player.name}</Text><Text color="$color10">{player.teamId ? label(config, player.teamId) : 'Player'} · {session.scores[player.id] ?? 0}</Text></YStack><Button size="$3" circular icon={Minus} onPress={() => score(player.id, -config.scoreStep)} aria-label={`Subtract ${config.scoreStep} from ${player.name}`} /><Button size="$4" circular icon={Plus} background={player.color ?? config.accent} onPress={() => score(player.id, config.scoreStep)} aria-label={`Add ${config.scoreStep} to ${player.name}`} /></XStack>)}
      {config.turnSeconds > 0 ? <YStack gap="$2" style={{ padding: 12, borderRadius: 8, backgroundColor: `${config.accent}15` }}><XStack style={{ alignItems: 'center', justifyContent: 'space-between' }}><XStack gap="$2" style={{ alignItems: 'center' }}><Text fontWeight="700">Timer</Text><Text color="$color10">{active ? active.name : 'Turn'}</Text></XStack><Text fontSize="$6" fontWeight="800">{minutes}:{seconds}</Text></XStack><XStack gap="$2"><Button flex={1} icon={running ? Pause : Play} onPress={() => setRunning((value) => !value)} aria-label={running ? 'Pause timer' : 'Start timer'}>{running ? 'Pause' : 'Start'}</Button><Button icon={RotateCcw} onPress={() => { setRunning(false); setTimer(config.turnSeconds); }} aria-label="Reset timer" /></XStack></YStack> : null}
      <XStack gap="$2"><Button flex={1} icon={ChevronRight} onPress={turn} disabled={session.completed} aria-label="Next turn">Next turn</Button><Button icon={Undo2} onPress={undo} disabled={!history.past.length} aria-label="Undo" /><Button icon={Redo2} onPress={redo} disabled={!history.future.length} aria-label="Redo" /><Button icon={RotateCcw} onPress={reset} aria-label="Reset game" /></XStack>
      {session.completed ? <YStack gap="$1" style={{ padding: 14, borderRadius: 8, backgroundColor: `${config.accent}22` }}><Text fontSize="$6" fontWeight="800">🏆 {session.winnerId ? `${label(config, session.winnerId)} wins` : 'Game complete'}</Text><Text color="$color10">Session stopped. Reset to play again.</Text></YStack> : null}
      <XStack gap="$2"><Button onPress={exportSnapshot}>Export snapshot</Button>{snapshot ? <Button onPress={restore}>Restore</Button> : null}</XStack>
      {snapshot ? <Text selectable numberOfLines={4} fontSize="$2" color="$color10" accessibilityLabel="Session snapshot">{snapshot}</Text> : null}
    </ScrollView>
  </YStack>;
}
