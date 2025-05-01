'use client';

import * as React from 'react';
import Link from 'next/link';
import { getTestRuns } from '@/lib/data';
import type { TestRun } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { CheckCircle, XCircle, SkipForward, Clock, ListChecks } from 'lucide-react';
import { LoadingSpinner } from '@/components/common/loading-spinner';
import { ErrorDisplay } from '@/components/common/error-display';
import { cn } from '@/lib/utils';

export default function TestRunsPage() {
  const [runs, setRuns] = React.useState<TestRun[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const runData = await getTestRuns(20); // Fetch last 20 runs
        setRuns(runData);
      } catch (err) {
        console.error("Failed to load test runs:", err);
        setError("Could not load test run history. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const getOverallStatus = (run: TestRun): 'Passed' | 'Failed' | 'Mixed' => {
    if (run.failed > 0) return 'Failed';
    if (run.passed > 0 && run.skipped === 0) return 'Passed';
    return 'Mixed'; // Passed with skips or only skips
  };

  const getStatusBadgeVariant = (status: 'Passed' | 'Failed' | 'Mixed'): "default" | "destructive" | "secondary" => {
      switch (status) {
          case 'Passed': return 'default'; // Will use primary color (greenish)
          case 'Failed': return 'destructive';
          case 'Mixed': return 'secondary'; // Neutral/grayish
          default: return 'secondary';
      }
  }

   if (error) {
        return <ErrorDisplay message={error} />;
    }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold tracking-tight">Test Run History</CardTitle>
          <CardDescription>Overview of past test executions.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[400px] flex justify-center items-center">
              <LoadingSpinner size={40} />
            </div>
          ) : runs.length === 0 ? (
             <div className="text-center text-muted-foreground py-16">No test runs found.</div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right text-green-600">Passed</TableHead>
                    <TableHead className="text-right text-red-600">Failed</TableHead>
                    <TableHead className="text-right text-yellow-600">Skipped</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const overallStatus = getOverallStatus(run);
                    return (
                      <TableRow key={run.id} className="hover:bg-muted/50 cursor-pointer">
                        <TableCell className="font-medium">
                            {/* Make Run ID clickable later if a run details page is added */}
                           {/* <Link href={`/runs/${run.id}`} className="text-primary hover:underline">{run.id}</Link> */}
                           {run.id}
                        </TableCell>
                        <TableCell>{format(run.timestamp, 'PP pp')}</TableCell>
                        <TableCell className="text-center">
                           <Badge variant={getStatusBadgeVariant(overallStatus)} className="text-xs">
                             {overallStatus}
                           </Badge>
                        </TableCell>
                        <TableCell className="text-right">{run.totalTests}</TableCell>
                        <TableCell className="text-right">{run.passed}</TableCell>
                        <TableCell className="text-right">{run.failed}</TableCell>
                        <TableCell className="text-right">{run.skipped}</TableCell>
                        <TableCell className="text-right">{(run.duration / 1000).toFixed(1)}s</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
