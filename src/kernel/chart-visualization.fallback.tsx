import Svg, { Polyline, Rect } from 'react-native-svg';

export type ChartDatum = { x: string; y: number };
export type ChartGeometry = {
  points: string;
  bars: Array<{ key: string; x: number; y: number; width: number; height: number }>;
};

const VIEWBOX_WIDTH = 320;
const VIEWBOX_HEIGHT = 180;
const PADDING = 18;

export function buildChartGeometry(input: ChartDatum[], width = VIEWBOX_WIDTH, height = VIEWBOX_HEIGHT): ChartGeometry {
  const data = input.filter((item) => Number.isFinite(item.y)).map((item, index) => ({
    x: item.x || String(index + 1),
    y: item.y,
  }));
  if (!data.length) return { points: '', bars: [] };

  const min = Math.min(0, ...data.map((item) => item.y));
  const max = Math.max(0, ...data.map((item) => item.y));
  const range = max - min || 1;
  const plotHeight = height - PADDING * 2;
  const baseline = PADDING + (max / range) * plotHeight;
  const gap = width / data.length;
  const valueY = (value: number) => PADDING + ((max - value) / range) * plotHeight;
  const points = data.map((item, index) => `${index * gap + gap / 2},${valueY(item.y)}`).join(' ');
  const bars = data.map((item, index) => {
    const valueYPosition = valueY(item.y);
    return {
      key: `${item.x}-${index}`,
      x: index * gap + 6,
      y: Math.min(valueYPosition, baseline),
      width: Math.max(gap - 12, 4),
      height: Math.max(Math.abs(baseline - valueYPosition), 1),
    };
  });
  return { points, bars };
}

export function ChartVisualization({ data, type }: { data: ChartDatum[]; type?: unknown }) {
  const geometry = buildChartGeometry(data);
  return <Svg width="100%" height={String(VIEWBOX_HEIGHT)} viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} accessibilityLabel="Chart">
    {type === 'line'
      ? <Polyline points={geometry.points} fill="none" stroke="#238457" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
      : geometry.bars.map((bar) => <Rect key={bar.key} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={4} fill="#238457" />)}
  </Svg>;
}
