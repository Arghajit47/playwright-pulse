'use client';

import * as React from 'react';
import { TrendingUp } from 'lucide-react';
import { Label, Pie, PieChart, Sector } from 'recharts';
import type { PieSectorDataItem } from 'recharts/types/polar/Pie';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import type { TestRun } from '@/types';

interface TestStatusPieChartProps {
  data: TestRun | null;
  loading?: boolean;
}

const chartConfig = {
  passed: {
    label: 'Passed',
    color: 'hsl(var(--chart-1))', // Teal (Accent)
  },
  failed: {
    label: 'Failed',
    color: 'hsl(var(--chart-2))', // Red (Destructive)
  },
  skipped: {
    label: 'Skipped',
    color: 'hsl(var(--chart-3))', // Orange/Yellow
  },
} satisfies ChartConfig;

export function TestStatusPieChart({ data, loading }: TestStatusPieChartProps) {
  const chartData = React.useMemo(() => {
    if (!data) return [];
    return [
      { name: 'passed', value: data.passed, fill: 'var(--color-passed)' },
      { name: 'failed', value: data.failed, fill: 'var(--color-failed)' },
      { name: 'skipped', value: data.skipped, fill: 'var(--color-skipped)' },
    ].filter(item => item.value > 0); // Filter out zero values for cleaner chart
  }, [data]);

  const totalTests = React.useMemo(() => {
    return data ? data.totalTests : 0;
  }, [data]);

  const id = React.useId();

  if (loading) {
      return (
          <Card className="flex flex-col h-[350px] justify-center items-center">
              <CardHeader className="items-center pb-0">
                  <CardTitle>Test Status Distribution</CardTitle>
                  <CardDescription>Latest Run Summary</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 pb-0 flex justify-center items-center">
                  <div className="text-muted-foreground">Loading chart data...</div>
                  {/* Optional: Add a spinner here */}
              </CardContent>
              <CardFooter className="flex-col gap-2 text-sm">
                 <div className="leading-none text-muted-foreground">
                    Calculating results...
                 </div>
              </CardFooter>
          </Card>
      )
  }

  if (!data || totalTests === 0) {
      return (
          <Card className="flex flex-col h-[350px] justify-center items-center">
              <CardHeader className="items-center pb-0">
                  <CardTitle>Test Status Distribution</CardTitle>
                   <CardDescription>No Test Data Available</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 pb-0 flex justify-center items-center">
                  <div className="text-muted-foreground">Run completed with no tests executed.</div>
              </CardContent>
               <CardFooter className="flex-col gap-2 text-sm">
                 <div className="leading-none text-muted-foreground">
                    Run ID: {data?.id || 'N/A'}
                 </div>
              </CardFooter>
          </Card>
      )
  }


  return (
    <Card className="flex flex-col h-[350px]">
      <CardHeader className="items-center pb-0">
        <CardTitle>Test Status Distribution</CardTitle>
        <CardDescription>Latest Run Summary (Run ID: {data.id})</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel hideIndicator />}
            />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={60}
              strokeWidth={5}
              activeIndex={0} // Consider making this dynamic on hover later
              activeShape={({ outerRadius = 0, ...props }: PieSectorDataItem) => (
                <Sector {...props} outerRadius={outerRadius + 5} />
              )}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {totalTests.toLocaleString()}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className="fill-muted-foreground text-sm"
                        >
                          Tests
                        </tspan>
                      </text>
                    );
                  }
                  return null; // Added default return value
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 font-medium leading-none">
          Run Duration: {(data.duration / 1000).toFixed(2)}s
          <TrendingUp className="h-4 w-4" /> {/* Example icon */}
        </div>
        <div className="leading-none text-muted-foreground">
          Showing total tests for the latest run
        </div>
      </CardFooter>
    </Card>
  );
}
