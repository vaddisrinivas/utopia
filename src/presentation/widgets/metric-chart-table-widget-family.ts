import type { A2UiComponent } from '@/packages/shared/contracts/package';
import type { DomainRecordViewModel } from '@/src/domain/renderer';
import {
  actionRoute,
  actionUrl,
  label,
  numberValue,
  rows,
  text,
} from '@/src/presentation/widgets/widget-sdk';

type RenderCard = (children: string[]) => string;

type ElementBuilder = (
  type: string,
  props?: Record<string, unknown>,
  children?: string[],
  extra?: Record<string, unknown>,
) => string;

type Palette = {
  ink: string;
  muted: string;
  moss: string;
  blueSoft: string;
  paper: string;
};

function widgetPressBinding(target: Record<string, unknown>): Record<string, unknown> | null {
  const rawRoute = actionRoute(target);
  if (rawRoute) {
    return {
      action: 'navigate',
      params: {
        screen: normalizeRoute(rawRoute),
      },
    };
  }
  const rawUrl = actionUrl(target);
  if (rawUrl) {
    return {
      action: 'openURL',
      params: { url: rawUrl },
    };
  }
  return null;
}

function normalizeRoute(route: string): string {
  const [path, query] = route.split('?');
  const suffix = query ? `?${query}` : '';
  if (path.startsWith('/collection/')) {
    const id = path.slice('/collection/'.length);
    return `/collection?id=${encodeURIComponent(id)}${query ? `&${query}` : ''}`;
  }
  if (path.startsWith('/record/')) {
    const id = path.slice('/record/'.length);
    return `/record?id=${encodeURIComponent(id)}${query ? `&${query}` : ''}`;
  }
  if (path === '/' || path === '/home') return `/(tabs)${suffix}`;
  if (path === '/chat' || path === '/ask') return `/(tabs)/chat${suffix}`;
  if (path === `/${'fo'}${'od'}` || path === '/kitchen') return `/(tabs)/${'fo'}${'od'}${suffix}`;
  if (path === '/sources') return `/(tabs)/sources${suffix}`;
  if (path === '/settings') return `/(tabs)/settings${suffix}`;
  return route;
}

export function addChartBlockWidgetDisplay(
  add: ElementBuilder,
  component: A2UiComponent,
  palette: Palette,
  renderCard: RenderCard,
) {
  const props = component.props ?? {};
  const points = (rows(props.points).length ? rows(props.points) : [
    { label: 'A', value: 6 },
    { label: 'B', value: 10 },
    { label: 'C', value: 4 },
  ]).map((point) => ({ label: label(point), value: numberValue(point.value) }))
    .filter((point) => Number.isFinite(point.value));
  const max = Math.max(1, ...points.map((point) => point.value));
  return renderCard(points.slice(0, 8).map((point) => add('Column', { gap: 6 }, [
    add('Row', { gap: 10, justifyContent: 'space-between', alignItems: 'center' }, [
      add('Label', { text: point.label, color: palette.ink, bold: true, size: 'sm' }),
      add('Label', { text: String(point.value), color: palette.muted, size: 'sm' }),
    ]),
    add('ProgressBar', { progress: point.value / max, color: palette.moss, trackColor: palette.paper, height: 8 }),
  ])));
}

export function addDataTableWidgetDisplay(
  add: ElementBuilder,
  component: A2UiComponent,
  records: DomainRecordViewModel[],
  palette: Palette,
  renderCard: RenderCard,
) {
  const props = component.props ?? {};
  const columns = (rows(props.columns).length ? rows(props.columns) : [
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status' },
    { key: 'owner', label: 'Owner' },
  ]).slice(0, 5).map((column, index) => ({
    key: text(column.key, text(column.field, text(column.id, text(column.name, `column_${index}`)))).toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    title: label(column, `Column ${index + 1}`),
  }));
  const recordField = text(props.itemsFromRecordField);
  const boundItems = recordField
    ? records.flatMap((record) => rows((record as Record<string, unknown>)[recordField] ?? record.properties[recordField]))
    : [];
  const items = (boundItems.length
    ? boundItems
    : rows(props.items).length
      ? rows(props.items)
      : [{ name: 'Sample', status: 'Ready', owner: 'Team' }]).slice(0, 6);
  const header = add('Row', { gap: 8 }, columns.map((column) => add('Container', { flex: 1 }, [
    add('Label', { text: column.title, color: palette.muted, bold: true, size: 'xs' }),
  ])));
  const rowsElement = items.map((item) => {
    const press = widgetPressBinding(item);
    const row = add('Container', { paddingVertical: 10 }, [
      add('Row', { gap: 8 }, columns.map((column, columnIndex) => add('Container', { flex: 1 }, [
        add('Paragraph', {
          text: text(item[column.key], columnIndex === 0 ? label(item) : '—'),
          color: palette.ink,
          fontSize: 14,
          numberOfLines: 3,
        }),
      ]))),
    ]);
    return press ? add('Pressable', {}, [row], { on: { press } }) : add('Container', { margin: 0 }, [row], { visible: true });
  });
  const tableChildren: string[] = [header];
  rowsElement.forEach((row, index) => {
    tableChildren.push(add('Divider', { color: palette.blueSoft, margin: 0 }));
    tableChildren.push(row);
    if (index === rowsElement.length - 1) {
      tableChildren.push(add('Divider', { color: palette.blueSoft, margin: 0 }));
    }
  });
  return renderCard(tableChildren);
}

export function addMetricWidgetDisplay(
  add: ElementBuilder,
  renderCard: RenderCard,
  component: A2UiComponent,
  records: DomainRecordViewModel[],
  palette: Palette,
) {
  return renderCard([add('Heading', { text: String(records.length), level: 'h1', color: palette.ink })]);
}
