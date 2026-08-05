import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { applyAction, emptyState, type AppState } from './runtime';
import type { AppAction, AppPackage } from './schema';
import { loadState, saveState } from './persistence';
import { syncDataHome } from './services';
import Storage from './storage';

export type Store = {
  state: AppState;
  ready: boolean;
  dispatch(action: AppAction): Promise<void>;
  sync(pkg: AppPackage, endpoint: string, homeId?: string): Promise<void>;
};

const Context = createContext<Store | null>(null);

export function AppStore({ appId, children }: { appId: string; children: ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const stateRef = useRef<AppState>(emptyState);
  const [ready, setReady] = useState(false);
  const key = `utopia:${appId}:state`;

  useEffect(() => {
    let active = true;
    loadState(Storage, key).then((restored) => {
      if (!active) return;
      stateRef.current = restored;
      setState(restored);
    }).catch(() => {}).finally(() => active && setReady(true));
    return () => { active = false; };
  }, [key]);

  const dispatch = useCallback(async (action: AppAction) => {
    const next = applyAction(stateRef.current, action);
    stateRef.current = next;
    setState(next);
    await saveState(Storage, key, next);
  }, [key]);

  const sync = useCallback(async (pkg: AppPackage, endpoint: string, homeId?: string) => {
    const next = await syncDataHome(pkg, stateRef.current, endpoint, homeId);
    stateRef.current = next;
    setState(next);
    await saveState(Storage, key, next);
  }, [key]);

  const value = useMemo(() => ({ state, ready, dispatch, sync }), [dispatch, ready, state, sync]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppStore(): Store {
  const value = useContext(Context);
  if (!value) throw new Error('AppStore missing');
  return value;
}

export const useOptionalAppStore = () => useContext(Context);
