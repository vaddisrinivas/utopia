import { describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react-native', () => ({ ChevronRight: 'ChevronRight', Minus: 'Minus', Pause: 'Pause', Play: 'Play', Plus: 'Plus', RotateCcw: 'RotateCcw', Trophy: 'Trophy', Undo2: 'Undo2', Redo2: 'Redo2' }));
vi.mock('tamagui', () => ({ Button: 'Button', H2: 'H2', Progress: Object.assign('Progress', { Indicator: 'Indicator' }), ScrollView: 'ScrollView', Text: 'Text', XStack: 'XStack', YStack: 'YStack' }));

import { applyGameAction, commitGameHistory, createGameHistory, createGameSession, exportGameSnapshot, GameConfigSchema, parseGameSnapshot, redoGameHistory, undoGameHistory } from '@/src/kernel/game-widget';

const config = GameConfigSchema.parse({
  schemaVersion: 'utopia.game.v3',
  title: 'Relay',
  players: [{ id: 'a', name: 'Ada', teamId: 'red' }, { id: 'b', name: 'Bea', teamId: 'red' }, { id: 'c', name: 'Cy' }],
  teams: [{ id: 'red', name: 'Red' }],
  rounds: 2,
  turnSeconds: 30,
  scoreStep: 2,
  win: { kind: 'score', target: 4 },
});

describe('game widget V3 contract', () => {
  it('rejects unknown fields and invalid player/team references', () => {
    expect(GameConfigSchema.safeParse({ ...config, extra: true }).success).toBe(false);
    expect(GameConfigSchema.safeParse({ ...config, players: [{ id: 'a', name: 'Ada', teamId: 'missing' }] }).success).toBe(false);
  });

  it('creates turns, bounded scores, team scores, and score win conditions', () => {
    const start = createGameSession(config);
    const scored = applyGameAction(start, config, { kind: 'score', playerId: 'a', delta: 4 });
    expect(scored.scores.a).toBe(4);
    expect(scored.completed).toBe(true);
    expect(scored.winnerId).toBe('red');
    expect(applyGameAction(start, config, { kind: 'score', playerId: 'unknown', delta: 50 })).toEqual(start);
  });

  it('advances turns and closes after the configured rounds', () => {
    const oneRound = GameConfigSchema.parse({ schemaVersion: 'utopia.game.v3', players: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bea' }], rounds: 1, win: { kind: 'rounds', target: 1 } });
    const afterA = applyGameAction(createGameSession(oneRound), oneRound, { kind: 'nextTurn' });
    const done = applyGameAction(afterA, oneRound, { kind: 'nextTurn' });
    expect(afterA.turnIndex).toBe(1);
    expect(done.completed).toBe(true);
  });

  it('keeps undo/redo recoverable and caps history at one hundred entries', () => {
    let history = createGameHistory(createGameSession(config));
    for (let index = 0; index < 120; index += 1) history = commitGameHistory(history, { ...history.present, round: Math.min(10000, index + 1) });
    expect(history.past).toHaveLength(100);
    const undone = undoGameHistory(history);
    expect(undone.present.round).toBe(119);
    expect(redoGameHistory(undone).present.round).toBe(120);
  });

  it('exports and strictly restores a bounded session snapshot', () => {
    const session = applyGameAction(createGameSession(config), config, { kind: 'score', playerId: 'a', delta: 2 });
    const restored = parseGameSnapshot(JSON.parse(exportGameSnapshot(session, 17)));
    expect(restored).toMatchObject({ scores: { a: 2 }, timerRemaining: 17 });
    expect(() => parseGameSnapshot({ ...restored, unsafe: true })).toThrow();
  });
});
