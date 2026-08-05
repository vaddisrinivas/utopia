import { Bar, CartesianChart, Line } from 'victory-native';

export function ChartVisualization({ data, type }: { data: Array<{ x: string; y: number }>; type?: unknown }) {
  return <CartesianChart data={data} xKey="x" yKeys={['y']} domainPadding={{ left: 18, right: 18, top: 20 }}>
    {({ points, chartBounds }) => type === 'line'
      ? <Line points={points.y} color="#238457" strokeWidth={5} curveType="natural" />
      : <Bar points={points.y} chartBounds={chartBounds} color="#238457" roundedCorners={{ topLeft: 5, topRight: 5 }} />}
  </CartesianChart>;
}
