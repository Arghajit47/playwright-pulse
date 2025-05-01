'use client';

import * as React from 'react';
import { getTrendData } from '@/lib/data';
import type { TrendDataPoint } from '@/types';
import { TrendsAreaChart } from '@/components/charts/trends-area-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/common/loading-spinner';
import { ErrorDisplay } from '@/components/common/error-display';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BarChart, LineChart } from 'lucide-react'; // Example icons for chart type toggle

export default function TrendsPage() {
  const [trendData, setTrendData] = React.useState<TrendDataPoint[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [timeRange, setTimeRange] = React.useState<number>(30); // Default to last 30 data points
  const [chartType, setChartType] = React.useState<'area' | 'bar'>('area'); // Example state for chart type

  React.useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getTrendData(timeRange);
        setTrendData(data);
      } catch (err) {
        console.error("Failed to load trend data:", err);
        setError("Could not load trend data. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [timeRange]); // Refetch when timeRange changes

  const handleTimeRangeChange = (value: string) => {
      setTimeRange(parseInt(value, 10));
  }

  if (error) {
       return <ErrorDisplay message={error} />;
   }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-2xl font-bold tracking-tight">Test Result Trends</CardTitle>
            <CardDescription>Visualize test execution results over time.</CardDescription>
          </div>
          <div className="flex gap-2">
             <Select value={timeRange.toString()} onValueChange={handleTimeRangeChange}>
                <SelectTrigger className="w-[180px]">
                   <SelectValue placeholder="Select Time Range" />
                </SelectTrigger>
                <SelectContent>
                   <SelectItem value="7">Last 7 Runs/Days</SelectItem>
                   <SelectItem value="15">Last 15 Runs/Days</SelectItem>
                   <SelectItem value="30">Last 30 Runs/Days</SelectItem>
                   <SelectItem value="90">Last 90 Runs/Days</SelectItem>
                </SelectContent>
             </Select>
              {/* Optional: Chart Type Selector
               <Select value={chartType} onValueChange={(v) => setChartType(v as 'area' | 'bar')}>
                   <SelectTrigger className="w-[100px]">
                       <SelectValue placeholder="Chart Type" />
                   </SelectTrigger>
                   <SelectContent>
                       <SelectItem value="area"><LineChart className="h-4 w-4 inline mr-2" /> Area</SelectItem>
                       <SelectItem value="bar"><BarChart className="h-4 w-4 inline mr-2" /> Bar</SelectItem>
                   </SelectContent>
               </Select>
               */}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[400px] flex justify-center items-center">
              <LoadingSpinner size={40} />
            </div>
          ) : trendData.length === 0 ? (
              <div className="text-center text-muted-foreground py-16">
                  No trend data available for the selected period.
              </div>
           ) : (
            // Conditionally render chart type later if needed
            <TrendsAreaChart data={trendData} loading={loading} />
            // {chartType === 'area' ? <TrendsAreaChart data={trendData} loading={loading}/> : <TrendsBarChart data={trendData} />}
          )}
        </CardContent>
      </Card>

       {/* Placeholder for potentially more trend charts */}
       {/*
       <Card>
         <CardHeader>
           <CardTitle>Test Duration Trends</CardTitle>
           <CardDescription>Average test duration over time.</CardDescription>
         </CardHeader>
         <CardContent>
           <div className="h-[300px] flex justify-center items-center text-muted-foreground">
             Duration chart placeholder
           </div>
         </CardContent>
       </Card>
       */}
    </div>
  );
}
