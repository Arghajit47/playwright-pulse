'use client';

import * as React from 'react';
import { getAllTestResults } from '@/lib/data';
import type { TestResult, TestStatus } from '@/types';
import { TestResultItem } from '@/components/test-results/test-result-item';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/common/loading-spinner';
import { ErrorDisplay } from '@/components/common/error-display';
import { Search, Filter } from 'lucide-react';

export default function AllTestsPage() {
  const [allTests, setAllTests] = React.useState<TestResult[]>([]);
  const [filteredTests, setFilteredTests] = React.useState<TestResult[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<TestStatus | 'all'>('all');
  const [suiteFilter, setSuiteFilter] = React.useState<string>('all');

  React.useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const tests = await getAllTestResults(); // Fetches tests from the latest run in mock data
        setAllTests(tests);
        setFilteredTests(tests); // Initialize filtered list
      } catch (err) {
        console.error("Failed to load test results:", err);
        setError("Could not load test results. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const uniqueSuites = React.useMemo(() => {
    const suites = new Set(allTests.map(test => test.suiteName).filter(Boolean));
    return ['all', ...Array.from(suites)] as string[];
  }, [allTests]);

  // Filter logic
  React.useEffect(() => {
    let results = allTests;

    // Filter by status
    if (statusFilter !== 'all') {
      results = results.filter(test => test.status === statusFilter);
    }

     // Filter by suite
    if (suiteFilter !== 'all') {
      results = results.filter(test => test.suiteName === suiteFilter);
    }

    // Filter by search term (name or suite)
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      results = results.filter(test =>
        test.name.toLowerCase().includes(lowerSearchTerm) ||
        (test.suiteName && test.suiteName.toLowerCase().includes(lowerSearchTerm))
      );
    }

    setFilteredTests(results);
  }, [searchTerm, statusFilter, suiteFilter, allTests]);

  if (error) {
      return <ErrorDisplay message={error} />;
  }


  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold tracking-tight">All Test Results</CardTitle>
          <CardDescription>Browse and filter all captured test results.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-6">
             {/* Search Input */}
            <div className="relative flex-1">
                 <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                 <Input
                    type="search"
                    placeholder="Search by test name or suite..."
                    className="pl-8 w-full"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                 />
            </div>

            {/* Filters */}
            <div className="flex gap-4">
                 <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TestStatus | 'all')}>
                     <SelectTrigger className="w-full md:w-[180px]">
                         <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                         <SelectValue placeholder="Filter by Status" />
                     </SelectTrigger>
                     <SelectContent>
                         <SelectItem value="all">All Statuses</SelectItem>
                         <SelectItem value="passed">Passed</SelectItem>
                         <SelectItem value="failed">Failed</SelectItem>
                         <SelectItem value="skipped">Skipped</SelectItem>
                     </SelectContent>
                 </Select>

                 <Select value={suiteFilter} onValueChange={setSuiteFilter}>
                    <SelectTrigger className="w-full md:w-[180px]">
                         <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                         <SelectValue placeholder="Filter by Suite" />
                     </SelectTrigger>
                     <SelectContent>
                         {uniqueSuites.map(suite => (
                            <SelectItem key={suite} value={suite}>
                                {suite === 'all' ? 'All Suites' : suite}
                             </SelectItem>
                         ))}
                     </SelectContent>
                 </Select>
            </div>
          </div>

          {loading ? (
             <div className="h-[400px] flex justify-center items-center">
               <LoadingSpinner size={40} />
             </div>
           ) : (
            <div className="border rounded-md">
                 {filteredTests.length > 0 ? (
                    filteredTests.map((test) => (
                        <TestResultItem key={test.id} result={test} viewMode="list" />
                    ))
                 ) : (
                    <div className="text-center text-muted-foreground py-16">
                        No tests found matching your criteria.
                    </div>
                 )}
             </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
