import { describe, expect, it } from 'vitest';

import { localeChain, localize } from '@/src/kernel/localization';

const source = {
  defaultLocale: 'en',
  fallbackLocale: 'fr',
  messages: { en: { title: 'Tasks' }, fr: { title: 'Taches' }, 'pt-br': { title: 'Tarefas' } },
};

describe('package localization', () => {
  it('uses region, base, default, and fallback locales', () => {
    expect(localeChain(source, 'pt-BR')).toEqual(['pt-br', 'pt', 'en', 'fr']);
    expect(localize({ title: '$l:title', untouched: '$l:missing' }, source, 'pt-BR')).toEqual({ title: 'Tarefas', untouched: '$l:missing' });
  });
});
