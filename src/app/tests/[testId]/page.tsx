'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { getTestResultById } from '@/lib/data';
import type { TestResult, TestStep, TestStatus } from '@/types';
import { TestStatusBadge } from '@/components/test-results/test-status-badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { format } from 'date-fns';
import {
  Clock,
  Hash,
  PlayCircle,
  Image as ImageIcon,
  Video,
  AlertTriangle,
  CheckCircle,
  XCircle,
  SkipForward,
  Code,
  ChevronRight,
  ChevronDown,
  FileText,
} from "lucide-react"; // Added FileText for trace
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { ErrorDisplay } from "@/components/common/error-display";
import { Button } from "@/components/ui/button";
import {
  analyzeTestFailure,
  type AnalyzeTestFailureOutput,
} from "@/ai/flows/analyze-test-failure"; // Assuming AI flow exists
import { Skeleton } from "@/components/ui/skeleton";

const StepStatusIcon = ({ status }: { status: TestStatus }) => {
  switch (status) {
    case "passed":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "skipped":
      return <SkipForward className="h-4 w-4 text-yellow-500" />;
    default:
      return <ChevronRight className="h-4 w-4 text-muted-foreground" />;
  }
};

export default function TestDetailPage() {
  const params = useParams();
  const testId = params.testId as string;

  const [testResult, setTestResult] = React.useState<TestResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] =
    React.useState<AnalyzeTestFailureOutput | null>(null);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!testId) return;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getTestResultById(testId);
        if (!result) {
          setError(`Test result with ID "${testId}" not found.`);
        }
        setTestResult(result);
      } catch (err) {
        console.error("Failed to load test result:", err);
        setError("Could not load test result details. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [testId]);

  const handleAnalyzeFailure = async () => {
    if (
      !testResult ||
      testResult.status !== "failed" ||
      !testResult.errorMessage ||
      !testResult.codeSnippet
    ) {
      setAiError(
        "Cannot analyze: Test did not fail or essential information (error, code snippet) is missing."
      );
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiAnalysis(null); // Clear previous analysis
    try {
      const analysis = await analyzeTestFailure({
        testName: testResult.name,
        testResult: `Error: ${testResult.errorMessage}\nStackTrace: ${
          testResult.stackTrace || "N/A"
        }`,
        codeSnippet: testResult.codeSnippet,
      });
      setAiAnalysis(analysis);
    } catch (err) {
      console.error("AI Analysis failed:", err);
      setAiError(
        "Failed to analyze the test failure. The AI service might be unavailable."
      );
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <LoadingSpinner size={40} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorDisplay message={error} />
      </div>
    );
  }

  if (!testResult) {
    return (
      <div className="p-6">
        <ErrorDisplay
          title="Not Found"
          message="Test result could not be loaded."
        />
      </div>
    );
  }

  const durationSeconds = (testResult.duration / 1000).toFixed(2);
  const formattedStartTime = format(testResult.startTime, "PPP p"); // e.g., Jun 15, 2024, 2:30:00 PM
  const formattedEndTime = format(testResult.endTime, "PPP p");

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl font-bold mb-1">
                {testResult.name}
              </CardTitle>
              <CardDescription>
                {testResult.suiteName
                  ? `Suite: ${testResult.suiteName} | `
                  : ""}{" "}
                Run ID: {testResult.runId}
              </CardDescription>
            </div>
            <TestStatusBadge
              status={testResult.status}
              className="text-sm px-3 py-1.5"
            />
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>Duration: {durationSeconds}s</span>
          </div>
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <span>Retries: {testResult.retries}</span>
          </div>
          <div className="flex items-center gap-2 text-xs md:text-sm col-span-2 md:col-span-1">
            <PlayCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate">Started: {formattedStartTime}</span>
          </div>
          <div className="flex items-center gap-2 text-xs md:text-sm col-span-2 md:col-span-1">
            <CheckCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate">Ended: {formattedEndTime}</span>
          </div>
        </CardContent>
      </Card>

      {/* Failure Details & AI Analysis */}
      {testResult.status === "failed" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Failure
              Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {testResult.errorMessage && (
              <div>
                <h4 className="font-semibold mb-1">Error Message:</h4>
                <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto">
                  <code>{testResult.errorMessage}</code>
                </pre>
              </div>
            )}
            {testResult.stackTrace && (
              <div>
                <h4 className="font-semibold mb-1">Stack Trace:</h4>
                <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto">
                  <code>{testResult.stackTrace}</code>
                </pre>
              </div>
            )}
            {/* AI Analysis Section */}
            {testResult.codeSnippet && ( // Only show AI if code is available
              <div className="pt-4 border-t">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-semibold">AI Failure Analysis</h4>
                  <Button
                    onClick={handleAnalyzeFailure}
                    disabled={aiLoading || !testResult.errorMessage}
                    size="sm"
                  >
                    {aiLoading && <LoadingSpinner size={16} className="mr-2" />}
                    Analyze Failure
                  </Button>
                </div>
                {aiError && (
                  <ErrorDisplay title="AI Analysis Error" message={aiError} />
                )}
                {aiLoading && (
                  <div className="space-y-2 mt-2">
                    <Skeleton className="h-4 w-1/4" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                )}
                {aiAnalysis && !aiLoading && (
                  <div className="bg-secondary p-4 rounded-md space-y-3 text-sm">
                    <div>
                      <strong className="text-primary">Root Cause:</strong>
                      <p className="mt-1">{aiAnalysis.rootCause}</p>
                    </div>
                    <div>
                      <strong className="text-primary">Suggested Fix:</strong>
                      <p className="mt-1">{aiAnalysis.suggestedFix}</p>
                    </div>
                    <div>
                      <strong className="text-primary">Confidence:</strong>
                      <span
                        className={`ml-2 font-semibold ${
                          aiAnalysis.confidenceLevel > 0.7
                            ? "text-green-600"
                            : aiAnalysis.confidenceLevel > 0.4
                            ? "text-yellow-600"
                            : "text-red-600"
                        }`}
                      >
                        {(aiAnalysis.confidenceLevel * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs for Steps, Attachments, Code */}
      <Tabs defaultValue="steps">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="steps">Test Steps</TabsTrigger>
          <TabsTrigger value="attachments">Attachments</TabsTrigger>
          <TabsTrigger value="code">Source Code</TabsTrigger>
        </TabsList>

        {/* Steps Tab */}
        <TabsContent value="steps">
          <Card>
            <CardHeader>
              <CardTitle>Test Execution Steps</CardTitle>
              <CardDescription>
                Detailed breakdown of the test execution flow.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {testResult.steps?.length > 0 ? (
                <Accordion type="single" collapsible className="w-full">
                  {testResult.steps.map((step, index) => (
                    <AccordionItem value={`step-${index}`} key={step.id}>
                      <AccordionTrigger className="text-sm hover:no-underline">
                        <div className="flex items-center gap-3 flex-1 text-left">
                          <StepStatusIcon status={step.status} />
                          <span className="font-medium flex-1">
                            {step.title}
                          </span>
                          <span className="text-xs text-muted-foreground mr-4">
                            <Clock className="inline h-3 w-3 mr-1" />
                            {formatDuration(step.duration)}
                          </span>
                          {/* Chevron handled by AccordionTrigger */}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pl-10 text-xs space-y-2">
                        <p>
                          Status:{" "}
                          <span className="font-semibold capitalize">
                            {step.status}
                          </span>
                        </p>
                        <p>Started: {format(step.startTime, "p")}</p>
                        <p>Ended: {format(step.endTime, "p")}</p>
                        {step.errorMessage && (
                          <p className="text-destructive">
                            Error: {step.errorMessage}
                          </p>
                        )}
                        {/* Step attachments are no longer displayed here */}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              ) : (
                <p className="text-muted-foreground text-center py-4">
                  No steps recorded for this test.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attachments Tab */}
        <TabsContent value="attachments">
          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
              <CardDescription>
                Screenshots, videos, and traces captured during the test
                execution.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Screenshots */}
              {testResult.screenshots && testResult.screenshots.length > 0 ? (
                <div>
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <ImageIcon className="h-4 w-4" /> Screenshots
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {testResult.screenshots.map((src, index) => (
                      <Image
                        key={index}
                        data-ai-hint="test failure screenshot"
                        src={src} // Can be data URI or relative path
                        alt={`Screenshot ${index + 1}`}
                        width={300} // Adjust size as needed
                        height={200}
                        className="rounded border shadow-md object-contain"
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground p-4 border rounded text-center">
                  No screenshots available for this test.
                </div>
              )}

              {/* Video */}
              {testResult.videoPath ? (
                <div>
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Video className="h-4 w-4" /> Video Recording
                  </h4>
                  {/* Assuming relative path */}
                  <a
                    href={`/${testResult.videoPath}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-2"
                  >
                    <PlayCircle className="h-5 w-5" />
                    View Video Recording
                  </a>
                  {/* Consider embedding a player if paths are served correctly */}
                  {/* <video controls width="100%" className="mt-2 rounded border">
                                <source src={`/${testResult.videoPath}`} type="video/webm" /> // Adjust type if needed
                                Your browser does not support the video tag.
                             </video> */}
                </div>
              ) : (
                <div className="text-muted-foreground p-4 border rounded text-center">
                  No video recording available.
                </div>
              )}

              {/* Trace */}
              {testResult.tracePath ? (
                <div>
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4" /> Trace File
                  </h4>
                  <a
                    href={`/${testResult.tracePath}`}
                    download
                    className="text-primary hover:underline flex items-center gap-2"
                  >
                    <FileText className="h-5 w-5" />
                    Download Trace File (.zip)
                  </a>
                </div>
              ) : (
                <div className="text-muted-foreground p-4 border rounded text-center">
                  No trace file available.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Code Tab */}
        <TabsContent value="code">
          <Card>
            <CardHeader>
              <CardTitle>Source Code</CardTitle>
              <CardDescription>
                The relevant code snippet from the test file.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {testResult.codeSnippet ? (
                <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto">
                  <code className="language-javascript">
                    {testResult.codeSnippet}
                  </code>
                </pre>
              ) : (
                <p className="text-muted-foreground text-center py-4">
                  Source code snippet not available.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper function to format duration
function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const seconds = ms / 1000;
  return seconds.toFixed(2) + "s";
}
