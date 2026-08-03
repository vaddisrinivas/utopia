export const APP_PACKAGE_WIDGET_KINDS = [
  'assistantChat',
  'healthConnect',
  'schemaEditor',
  'widgetCatalog',
  'postCard',
  'pollCard',
  'linkPreview',
  'feedList',
  'kanbanBoard',
  'smartCapture',
  'chartBlock',
  'mediaBlock',
  'videoPlayer',
  'cameraScanner',
  'mapBlock',
  'locationMap',
  'sensorReadout',
  'formCard',
  'checklistCard',
  'calendarBlock',
  'notificationScheduler',
  'contactPicker',
  'calendarEvent',
  'biometricGate',
  'healthKitStatus',
  'speechTool',
  'timelineBlock',
  'galleryGrid',
  'dataTable',
  'permissionCard',
  'capabilityExerciser',
  'filePicker',
  'fileExport',
  'providerStatus',
  'themePreview',
  'themeDensitySelector',
  'aiProviderSettings',
  'dataHomeSettings',
  'scientificCalculator',
  'audioLoopPlayer',
  'stepFlow',
  'durationTimer',
  'valueControl',
  'operationHistory',
  'quickAddList',
  'structuredList',
  'groupedRecordShelf',
  'horizontalRecordCarousel',
  'recordHeroSummary',
  'recordTimeline',
  'recordContentCard',
  'recordReviewCard',
  'askFoodBar',
] as const;

export const CAPABILITY_DIAGNOSTIC_RUNTIME_STATES = [
  'unrequested',
  'requested',
  'granted',
  'denied',
  'blocked',
  'unavailable',
  'success',
  'interrupted',
] as const;

export type CapabilityDiagnosticRuntimeState = typeof CAPABILITY_DIAGNOSTIC_RUNTIME_STATES[number];

export type CapabilityDiagnosticObservation = Readonly<{
  capabilityId: string;
  state: CapabilityDiagnosticRuntimeState;
  observed?: boolean;
  observedAt?: string;
  detail?: string;
}>;

export type AppPackageWidgetKind = typeof APP_PACKAGE_WIDGET_KINDS[number];

export const APP_PACKAGE_WIDGET_KIND_SET = new Set<string>([...APP_PACKAGE_WIDGET_KINDS]);

export function isAppPackageWidgetKind(value: unknown): value is AppPackageWidgetKind {
  return typeof value === 'string' && APP_PACKAGE_WIDGET_KIND_SET.has(value);
}

export type RecordReviewCardItem = {
  id?: string;
  title?: string;
  subtitle?: string;
  status?: string;
  detail?: string;
};

export type RecordReviewCardAction = {
  id?: string;
  title?: string;
  label?: string;
  route?: string;
  url?: string;
};

export type RecordReviewCardProps = {
  title?: string;
  subtitle?: string;
  badge?: string;
  emoji?: string;
  items?: RecordReviewCardItem[];
  actions?: RecordReviewCardAction[];
};

export type RecordContentCardChip = {
  id?: string;
  label?: string;
  title?: string;
  value?: string | number;
};

export type RecordContentCardAction = {
  id?: string;
  title?: string;
  label?: string;
  route?: string;
  url?: string;
};

export type RecordContentCardProps = {
  title?: string;
  subtitle?: string;
  body?: string;
  badge?: string;
  emoji?: string;
  imageUrl?: string;
  chips?: RecordContentCardChip[];
  actions?: RecordContentCardAction[];
  route?: string;
  url?: string;
};
