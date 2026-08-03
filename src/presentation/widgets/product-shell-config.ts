import type { WidgetProps } from '@/src/presentation/widgets/widget-sdk';

export type ProductShellLegacyLayoutMode =
  | 'collectionWorkspace'
  | 'focusedTool'
  | 'dashboardWorkspace';

export type ProductShellCompositionMode =
  | 'single'
  | 'masterDetail'
  | 'dashboard';

export type ProductShellLayoutMode = ProductShellLegacyLayoutMode | ProductShellCompositionMode;

export type ProductShellDensity = 'compact' | 'comfortable' | 'spacious';

export type ProductShellActionTone = 'primary' | 'secondary' | 'quiet' | 'danger';

export type ProductShellStatusTone = 'info' | 'success' | 'warning' | 'error';

export type ProductShellTheme = Readonly<{
  canvas: string;
  surface: string;
  surfaceMuted: string;
  ink: string;
  muted: string;
  accent: string;
  accentContrast: string;
  border: string;
  danger: string;
  dangerContrast: string;
  statusInfo: string;
  statusSuccess: string;
  statusWarning: string;
  statusError: string;
}>;

export type ProductShellResponsive = Readonly<{
  breakpoint: number;
  maxContentWidth: number;
  narrowPadding: number;
  widePadding: number;
}>;

export type ProductShellComposition = Readonly<{
  mode: ProductShellCompositionMode;
  ratio?: number;
  dashboardColumns?: number;
}>;

export type ProductShellTab = Readonly<{
  id: string;
  label: string;
  icon?: string;
  screen?: string;
  disabled?: boolean;
}>;

export type ProductShellAction = Readonly<{
  id: string;
  label: string;
  icon?: string;
  tone: ProductShellActionTone;
  disabled?: boolean;
  event?: string;
}>;

export type ProductShellStatus = Readonly<{
  message: string;
  tone: ProductShellStatusTone;
  dismissible: boolean;
}>;

export type ProductShellConfig = Readonly<{
  layoutMode: ProductShellLayoutMode;
  composition: ProductShellComposition;
  title: string;
  subtitle: string;
  eyebrow: string;
  showBack: boolean;
  scrollable: boolean;
  tabs: readonly ProductShellTab[];
  activeTab: string;
  bottomActions: readonly ProductShellAction[];
  status?: ProductShellStatus;
  theme: ProductShellTheme;
  density: ProductShellDensity;
  responsive: ProductShellResponsive;
}>;

export const DEFAULT_PRODUCT_SHELL_THEME: ProductShellTheme = {
  canvas: '#F7F8F6',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF1ED',
  ink: '#18231D',
  muted: '#66736A',
  accent: '#236B4E',
  accentContrast: '#FFFFFF',
  border: '#D9E1DA',
  danger: '#B42318',
  dangerContrast: '#FFFFFF',
  statusInfo: '#DCEAF7',
  statusSuccess: '#DDEFE3',
  statusWarning: '#FFF0C7',
  statusError: '#FCE0DD',
};

export const DEFAULT_PRODUCT_SHELL_RESPONSIVE: ProductShellResponsive = {
  breakpoint: 720,
  maxContentWidth: 1280,
  narrowPadding: 16,
  widePadding: 32,
};

export const DEFAULT_PRODUCT_SHELL_COMPOSITION: ProductShellComposition = {
  mode: 'single',
};

export const DEFAULT_PRODUCT_SHELL_CONFIG: ProductShellConfig = {
  layoutMode: 'collectionWorkspace',
  composition: DEFAULT_PRODUCT_SHELL_COMPOSITION,
  title: 'Workspace',
  subtitle: '',
  eyebrow: '',
  showBack: false,
  scrollable: false,
  tabs: [],
  activeTab: '',
  bottomActions: [],
  theme: DEFAULT_PRODUCT_SHELL_THEME,
  density: 'comfortable',
  responsive: DEFAULT_PRODUCT_SHELL_RESPONSIVE,
};

type UnknownRecord = Record<string, unknown>;

export function normalizeProductShellConfig(value: WidgetProps | UnknownRecord | undefined): ProductShellConfig {
  const props = (isRecord(value) ? value : {}) as UnknownRecord;
  const tabs = normalizeTabs(props.tabs);
  const bottomActions = normalizeActions(props.bottomActions);
  const activeTab = stringValue(props.activeTab, tabs[0]?.id ?? '');
  const composition = normalizeComposition(props);

  return {
    ...DEFAULT_PRODUCT_SHELL_CONFIG,
    layoutMode: layoutModeValue(props.layoutMode ?? props.layout),
    composition,
    title: stringValue(props.appBarTitle ?? props.title, DEFAULT_PRODUCT_SHELL_CONFIG.title),
    subtitle: stringValue(props.appBarSubtitle ?? props.subtitle),
    eyebrow: stringValue(props.appBarEyebrow ?? props.eyebrow),
    showBack: props.showBack === true,
    scrollable: props.scrollable === true,
    tabs,
    activeTab: tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0]?.id ?? '',
    bottomActions,
    status: normalizeStatus(props.statusBanner ?? props.status),
    theme: normalizeTheme(props.theme),
    density: densityValue(props.density),
    responsive: normalizeResponsive(props.responsive),
  };
}

function normalizeComposition(value: UnknownRecord): ProductShellComposition {
  const composition = isRecord(value.composition) ? value.composition : {};
  const dashboard = isRecord(value.dashboard) ? value.dashboard : {};
  const rawMode = value.compositionMode ?? composition.mode ?? value.layoutMode ?? value.layout;
  const dashboardColumns = positiveNumber(value.dashboardColumns ?? dashboard.columns, 2);
  const compositionRatio = value.ratio ?? composition.ratio;
  return {
    mode: compositionModeValue(rawMode),
    ratio: ratioValue(compositionRatio),
    dashboardColumns: clampInt(dashboardColumns, 2, 3),
  };
}

function normalizeTabs(value: unknown): readonly ProductShellTab[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const id = stringValue(candidate.id, `tab-${index + 1}`);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label: stringValue(candidate.label, id),
      ...(stringValue(candidate.icon) ? { icon: stringValue(candidate.icon) } : {}),
      ...(stringValue(candidate.screen) ? { screen: stringValue(candidate.screen) } : {}),
      ...(candidate.disabled === true ? { disabled: true } : {}),
    }];
  });
}

function normalizeActions(value: unknown): readonly ProductShellAction[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const id = stringValue(candidate.id, `action-${index + 1}`);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label: stringValue(candidate.label, id),
      tone: actionToneValue(candidate.tone ?? candidate.variant),
      ...(stringValue(candidate.icon) ? { icon: stringValue(candidate.icon) } : {}),
      ...(candidate.disabled === true ? { disabled: true } : {}),
      ...(stringValue(candidate.event) ? { event: stringValue(candidate.event) } : {}),
    }];
  });
}

function normalizeStatus(value: unknown): ProductShellStatus | undefined {
  if (typeof value === 'string' && value.trim()) {
    return { message: value.trim(), tone: 'info', dismissible: false };
  }
  if (!isRecord(value)) return undefined;
  const message = stringValue(value.message ?? value.label);
  if (!message) return undefined;
  return {
    message,
    tone: statusToneValue(value.tone),
    dismissible: value.dismissible === true,
  };
}

function normalizeTheme(value: unknown): ProductShellTheme {
  if (!isRecord(value)) return DEFAULT_PRODUCT_SHELL_THEME;
  const theme = { ...DEFAULT_PRODUCT_SHELL_THEME };
  for (const key of Object.keys(theme) as (keyof ProductShellTheme)[]) {
    if (typeof value[key] === 'string' && value[key].trim()) theme[key] = value[key].trim();
  }
  return theme;
}

function normalizeResponsive(value: unknown): ProductShellResponsive {
  if (!isRecord(value)) return DEFAULT_PRODUCT_SHELL_RESPONSIVE;
  return {
    breakpoint: positiveNumber(value.breakpoint, DEFAULT_PRODUCT_SHELL_RESPONSIVE.breakpoint),
    maxContentWidth: positiveNumber(value.maxContentWidth, DEFAULT_PRODUCT_SHELL_RESPONSIVE.maxContentWidth),
    narrowPadding: nonNegativeNumber(value.narrowPadding, DEFAULT_PRODUCT_SHELL_RESPONSIVE.narrowPadding),
    widePadding: nonNegativeNumber(value.widePadding, DEFAULT_PRODUCT_SHELL_RESPONSIVE.widePadding),
  };
}

function layoutModeValue(value: unknown): ProductShellLayoutMode {
  return (value === 'focusedTool'
    || value === 'dashboardWorkspace'
    || value === 'collectionWorkspace'
    || value === 'single'
    || value === 'masterDetail'
    || value === 'dashboard')
    ? value
    : 'collectionWorkspace';
}

function compositionModeValue(value: unknown): ProductShellCompositionMode {
  if (value === 'masterDetail' || value === 'dashboard') return value;
  if (value === 'focusedTool' || value === 'collectionWorkspace') return 'single';
  if (value === 'dashboardWorkspace') return 'dashboard';
  if (value === 'single') return 'single';
  return 'single';
}

function ratioValue(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(0.78, Math.max(0.22, parsed));
}

function densityValue(value: unknown): ProductShellDensity {
  return value === 'compact' || value === 'spacious' ? value : 'comfortable';
}

function actionToneValue(value: unknown): ProductShellActionTone {
  return value === 'primary' || value === 'quiet' || value === 'danger' ? value : 'secondary';
}

function statusToneValue(value: unknown): ProductShellStatusTone {
  return value === 'success' || value === 'warning' || value === 'error' ? value : 'info';
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return 2;
  return Math.min(max, Math.max(min, rounded));
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
