export const supportedWidgetKinds = [
  'assistantChat', 'audioLoopPlayer', 'videoPlayer', 'dataTable', 'chartBlock', 'checklistCard',
  'durationTimer', 'stepFlow', 'scientificCalculator', 'formCard', 'smartCapture', 'postCard',
  'pollCard', 'feedList', 'calendarBlock', 'mediaBlock', 'galleryGrid', 'showcaseHero', 'cardCarousel',
  'eventTimeline', 'featureCard', 'reviewCard', 'tileGrid', 'providerStatus', 'widgetCatalog',
  'permissionCard', 'filePicker', 'fileExport', 'locationMap', 'notificationScheduler', 'contactPicker',
  'calendarEvent', 'biometricGate', 'speechTool', 'healthConnect', 'healthKitStatus', 'cameraScanner',
  'sensorReadout', 'jsonUi', 'assetBlock', 'messageThread', 'canvasBoard', 'automationFlow', 'routePlanner', 'gameSession',
  'recordHeroSummary', 'structuredList', 'recordContentCard',
  'recordTimeline', 'kanbanBoard', 'operationHistory', 'timelineBlock', 'recordReviewCard',
  'recordMetric',
  'valueControl', 'groupedRecordShelf', 'quickAddList', 'horizontalRecordCarousel',
] as const;

export const supportedWidgets = new Set(supportedWidgetKinds);

export const recordWidgets = new Set([
  'formCard', 'smartCapture',
  'recordHeroSummary', 'structuredList', 'recordContentCard', 'recordTimeline', 'kanbanBoard',
  'operationHistory', 'timelineBlock', 'recordReviewCard', 'valueControl', 'groupedRecordShelf',
  'quickAddList', 'horizontalRecordCarousel',
]);

export const recordBindableWidgets = new Set(['dataTable', 'chartBlock', 'calendarBlock', 'galleryGrid', 'checklistCard']);

export function supportsWidget(kind?: string): boolean {
  return supportedWidgets.has((kind ?? '') as (typeof supportedWidgetKinds)[number]);
}
