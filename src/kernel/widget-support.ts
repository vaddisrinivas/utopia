export const widgetAliases: Record<string, string> = {
  foodHero: 'postCard', useFirstCarousel: 'galleryGrid', mealTimeline: 'calendarBlock',
  recipeCard: 'postCard', receiptReviewCard: 'permissionCard', pantryShelf: 'widgetCatalog',
  buttonBar: 'menuStrip', quickActions: 'menuStrip', segmentedTabs: 'segmentedControl',
  progressBar: 'progressStatus', progressRing: 'progressStatus', emptyScreen: 'emptyState',
  quickNav: 'navigationPanel', navMenu: 'navigationPanel', verticalNav: 'navigationPanel',
  menuRail: 'navigationPanel', quickOverlay: 'actionOverlay', modalPanel: 'actionOverlay',
  statusRail: 'statusDisplay', metricPanel: 'metricDisplay', statRail: 'metricDisplay',
};

export const supportedWidgetKinds = [
  'assistantChat', 'audioLoopPlayer', 'videoPlayer', 'dataTable', 'chartBlock', 'checklistCard',
  'durationTimer', 'stepFlow', 'scientificCalculator', 'formCard', 'smartCapture', 'postCard',
  'pollCard', 'feedList', 'calendarBlock', 'mediaBlock', 'galleryGrid', 'showcaseHero', 'cardCarousel',
  'eventTimeline', 'featureCard', 'reviewCard', 'tileGrid', 'providerStatus', 'widgetCatalog',
  'permissionCard', 'filePicker', 'fileExport', 'locationMap', 'notificationScheduler', 'contactPicker',
  'calendarEvent', 'biometricGate', 'speechTool', 'healthConnect', 'healthKitStatus', 'cameraScanner',
  'sensorReadout', 'jsonUi', 'assetBlock', 'messageThread', 'canvasBoard', 'automationFlow', 'routePlanner',
  'gameSession', 'recordHeroSummary', 'structuredList', 'recordContentCard', 'recordTimeline', 'kanbanBoard',
  'operationHistory', 'timelineBlock', 'recordReviewCard', 'recordMetric', 'valueControl', 'groupedRecordShelf',
  'quickAddList', 'horizontalRecordCarousel', 'menuStrip', 'segmentedControl', 'progressStatus', 'statusBanner',
  'emptyState', 'navigationPanel', 'actionOverlay', 'statusDisplay', 'metricDisplay',
] as const;

export const supportedWidgets = new Set<string>([...supportedWidgetKinds, ...Object.keys(widgetAliases)]);
export const recordWidgets = new Set([
  'formCard', 'smartCapture', 'recordHeroSummary', 'structuredList', 'recordContentCard', 'recordTimeline',
  'kanbanBoard', 'operationHistory', 'timelineBlock', 'recordReviewCard', 'valueControl', 'groupedRecordShelf',
  'quickAddList', 'horizontalRecordCarousel',
]);
export const recordBindableWidgets = new Set(['dataTable', 'chartBlock', 'calendarBlock', 'galleryGrid', 'checklistCard']);
export const normalizeWidgetKind = (kind = '') => widgetAliases[kind] ?? kind;
export const supportsWidget = (kind?: string) => supportedWidgets.has(kind ?? '') && supportedWidgets.has(normalizeWidgetKind(kind));
