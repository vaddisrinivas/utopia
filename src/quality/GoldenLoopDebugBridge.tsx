import { useEffect } from 'react';
import { Linking } from 'react-native';

import { useUtopiaDatabase } from '@/src/db/provider';
import { executeGoldenLoopDebugCommand } from '@/src/quality/golden-loop-debug-handler';
import {
  getGoldenLoopDebugToken,
  isGoldenLoopDebugEnabled,
  parseGoldenLoopDebugPayload,
} from '@/src/quality/golden-loop-debug-protocol';

type GoldenLoopDebugGlobal = typeof globalThis & {
  __UTOPIA_GOLDEN_LOOP_DEBUG__?: {
    execute: (command: unknown) => Promise<unknown>;
    status: () => { enabled: boolean; ready: boolean };
  };
  __UTOPIA_GOLDEN_LOOP_LAST_RESULT__?: unknown;
};

export function GoldenLoopDebugBridge() {
  const db = useUtopiaDatabase();
  const enabled = isGoldenLoopDebugEnabled();
  const token = getGoldenLoopDebugToken();

  useEffect(() => {
    const target = globalThis as GoldenLoopDebugGlobal;
    if (!enabled || !token || !db) {
      delete target.__UTOPIA_GOLDEN_LOOP_DEBUG__;
      return;
    }

    const execute = async (command: unknown) => {
      const result = await executeGoldenLoopDebugCommand(db, command, { expectedToken: token });
      target.__UTOPIA_GOLDEN_LOOP_LAST_RESULT__ = result;
      return result;
    };

    target.__UTOPIA_GOLDEN_LOOP_DEBUG__ = {
      execute,
      status: () => ({ enabled: true, ready: true }),
    };

    const handleUrl = (url: string) => {
      const payload = extractPayload(url);
      if (!payload) return;
      void execute(payload).catch((error) => {
        target.__UTOPIA_GOLDEN_LOOP_LAST_RESULT__ = {
          status: 'failed',
          error: error instanceof Error ? error.message : 'golden_loop_debug_link_failed',
        };
      });
    };

    void Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    }).catch(() => {});
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    return () => {
      if (target.__UTOPIA_GOLDEN_LOOP_DEBUG__?.execute === execute) {
        delete target.__UTOPIA_GOLDEN_LOOP_DEBUG__;
      }
      subscription.remove();
    };
  }, [db, enabled, token]);

  return null;
}

function extractPayload(url: string): unknown | null {
  try {
    const parsed = new URL(url);
    const isDebugLink = parsed.protocol === 'utopia:' && parsed.hostname === 'golden-loop-debug';
    if (!isDebugLink) return null;
    const payload = parsed.searchParams.get('payload');
    if (!payload) return null;
    return parseGoldenLoopDebugPayload(payload);
  } catch {
    return null;
  }
}

