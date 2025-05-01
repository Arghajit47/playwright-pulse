'use client';

import * as React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
  ChartLegend,
  ChartLegendContent
} from '@/components/ui/chart';
import type { TrendDataPoint } from '@/types';

interface TrendsAreaChartProps {
  data: TrendDataPoint[];
   loading?: boolean;
}

const chartConfig = {
  passed: {
    label: 'Passed',
    color: 'hsl(var(--chart-1))', // Teal
  },
  failed: {
    label: 'Failed',
    color: 'hsl(var(--chart-2))', // Red
  },
  skipped: {
    label: 'Skipped',
    color: 'hsl(var(--chart-3))', // Orange/Yellow
  },
} satisfies ChartConfig;

export function TrendsAreaChart({ data, loading }: TrendsAreaChartProps) {
  const id = React.useId();

   if (loading) {
    return (
      <Card className="h-[350px] flex justify-center items-center">
        <CardHeader>
          <CardTitle>Test Result Trends</CardTitle>
          <CardDescription>Loading trend data...</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 pb-0">
             <div className="text-muted-foreground">Loading chart...</div>
        </CardContent>
      </Card>
    )
  }

   if (!data || data.length === 0) {
        return (
            <Card className="h-[350px] flex flex-col justify-center items-center">
                <CardHeader className="items-center pb-0">
                    <CardTitle>Test Result Trends</CardTitle>
                    <CardDescription>No Trend Data Available</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 pb-0 flex justify-center items-center">
                    <div className="text-muted-foreground">Insufficient data points to display trends.</div>
                </CardContent>
            </Card>
        )
    }


  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Result Trends</CardTitle>
        <CardDescription>Showing test results over the last {data.length} runs/days.</CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="h-[250px]"> {/* Fixed height for chart */}
          <ChartContainer config={chartConfig}>
            <AreaChart
              accessibilityLayer
              data={data}
              margin={{
                left: 12,
                right: 12,
                top: 5,
                bottom: 5,
              }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => {
                   // Basic date formatting, adjust as needed
                   const date = new Date(value);
                   // Check if it's a valid date before formatting
                   if (!isNaN(date.getTime())) {
                       return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                   }
                   return value; // Fallback for non-date strings (like run IDs)
                }}
              />
              <YAxis
                 tickLine={false}
                 axisLine={false}
                 tickMargin={8}
                 allowDecimals={false} // Ensure whole numbers for counts
              />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
              <defs>
                  <linearGradient id={`fillPassed-${id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-passed)" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="var(--color-passed)" stopOpacity={0.1}/>
                  </linearGradient>
                  <linearGradient id={`fillFailed-${id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-failed)" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="var(--color-failed)" stopOpacity={0.1}/>
                  </linearGradient>
                   <linearGradient id={`fillSkipped-${id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-skipped)" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="var(--color-skipped)" stopOpacity={0.1}/>
                  </linearGradient>
              </defs>
              <Area
                dataKey="passed"
                type="natural"
                fill={`url(#fillPassed-${id})`}
                fillOpacity={0.4}
                stroke="var(--color-passed)"
                stackId="a"
              />
              <Area
                dataKey="failed"
                type="natural"
                fill={`url(#fillFailed-${id})`}
                fillOpacity={0.4}
                stroke="var(--color-failed)"
                stackId="a"
              />
              <Area
                dataKey="skipped"
                type="natural"
                fill={`url(#fillSkipped-${id})`}
                fillOpacity={0.4}
                stroke="var(--color-skipped)"
                stackId="a"
              />
                <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
