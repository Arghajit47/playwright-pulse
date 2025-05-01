'use client';

import * as React from 'react';
import { getLatestTestRun, getTrendData, getAllTestResults } from '@/lib/data';
import type { SummaryMetric, TestResult, TestRun, TrendDataPoint } from '@/types';
import { SummaryCard } from '@/components/dashboard/summary-card';
import { TestStatusPieChart } from '@/components/charts/test-status-pie-chart';
import { TrendsAreaChart } from '@/components/charts/trends-area-chart';
import { TestResultItem } from '@/components/test-results/test-result-item';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from "@/components/ui/scroll-area"
import { CheckCircle, XCircle, SkipForward, Clock, ListChecks } from 'lucide-react';
import { LoadingSpinner } from '@/components/common/loading-spinner';
import { ErrorDisplay } from '@/components/common/error-display';

export default function DashboardPage() {
  const [latestRun, setLatestRun] = React.useState<TestRun | null>(null);
  const [trendData, setTrendData] = React.useState<TrendDataPoint[]>([]);
  const [recentTests, setRecentTests] = React.useState<TestResult[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [runData, trends, tests] = await Promise.all([
          getLatestTestRun(),
          getTrendData(10), // Fetch last 10 data points for trends
          getAllTestResults() // Fetch recent test results (adjust as needed)
        ]);
        setLatestRun(runData);
        setTrendData(trends);
        setRecentTests(tests);
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
        setError("Could not load dashboard data. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const summaryMetrics: SummaryMetric[] = React.useMemo(() => {
    if (!latestRun) return [
        { label: 'Total Tests', value: 'N/A', icon: ListChecks },
        { label: 'Passed', value: 'N/A', icon: CheckCircle },
        { label: 'Failed', value: 'N/A', icon: XCircle },
        { label: 'Skipped', value: 'N/A', icon: SkipForward },
    ];
    return [
      { label: 'Total Tests', value: latestRun.totalTests, icon: ListChecks },
      { label: 'Passed', value: latestRun.passed, icon: CheckCircle, color: 'text-green-600' },
      { label: 'Failed', value: latestRun.failed, icon: XCircle, color: 'text-red-600' },
      { label: 'Skipped', value: latestRun.skipped, icon: SkipForward, color: 'text-yellow-600' },
      { label: 'Duration', value: `${(latestRun.duration / 1000).toFixed(1)}s`, icon: Clock },
    ];
  }, [latestRun]);

   if (error) {
       return <ErrorDisplay message={error} />;
   }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>

      {/* Summary Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
         {loading ? (
             Array.from({ length: 5 }).map((_, index) => (
                <Card key={index} className="h-[110px] flex justify-center items-center">
                  <LoadingSpinner size={20} />
                 </Card>
             ))
         ) : (
            summaryMetrics.map((metric) => (
                <SummaryCard key={metric.label} metric={metric} />
            ))
         )}
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        <TestStatusPieChart data={latestRun} loading={loading}/>
        <TrendsAreaChart data={trendData} loading={loading}/>
      </div>

      {/* Recent Test Results */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Test Results</CardTitle>
          <CardDescription>Latest tests from run {latestRun?.id || 'N/A'}.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
             <div className="h-[300px] flex justify-center items-center">
                 <LoadingSpinner />
             </div>
           ) : recentTests.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">No recent tests found.</div>
           ) : (
             <ScrollArea className="h-[400px]"> {/* Adjust height as needed */}
               <div className="space-y-2">
                 {recentTests.slice(0, 15).map((test) => ( // Limit display for performance
                   <TestResultItem key={test.id} result={test} viewMode="list" />
                 ))}
               </div>
             </ScrollArea>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
