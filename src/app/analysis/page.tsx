"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  analyzeTestFailure,
  type AnalyzeTestFailureOutput,
} from "@/ai/flows/analyze-test-failure";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { ErrorDisplay } from "@/components/common/error-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lightbulb, CheckCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const analysisFormSchema = z.object({
  testName: z.string().min(1, "Test name is required."),
  testResult: z
    .string()
    .min(10, "Test result details (logs, errors) are required."),
  codeSnippet: z.string().min(10, "Relevant code snippet is required."),
});

type AnalysisFormValues = z.infer<typeof analysisFormSchema>;

export default function AnalysisPage() {
  const [aiAnalysis, setAiAnalysis] =
    React.useState<AnalyzeTestFailureOutput | null>(null);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);

  const form = useForm<AnalysisFormValues>({
    resolver: zodResolver(analysisFormSchema),
    defaultValues: {
      testName: "",
      testResult: "",
      codeSnippet: "",
    },
  });

  const onSubmit = async (values: AnalysisFormValues) => {
    setAiLoading(true);
    setAiError(null);
    setAiAnalysis(null);
    try {
      const analysis = await analyzeTestFailure(values);
      setAiAnalysis(analysis);
    } catch (err) {
      console.error("AI Analysis failed:", err);
      setAiError(
        "Failed to analyze the test failure. The AI service might be unavailable or encountered an error."
      );
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-primary" /> AI Failure Analysis
          </CardTitle>
          <CardDescription>
            Paste your failed test details below to get insights into the root
            cause and potential fixes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="testName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Test Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., should login successfully"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="testResult"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Test Result (Logs & Errors)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Paste the full error message, logs, and stack trace here..."
                        className="min-h-[150px] font-mono text-xs"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="codeSnippet"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Relevant Code Snippet</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Paste the relevant part of your test code here..."
                        className="min-h-[100px] font-mono text-xs"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={aiLoading}
                className="w-full md:w-auto"
              >
                {aiLoading ? (
                  <LoadingSpinner size={16} className="mr-2" />
                ) : (
                  <Lightbulb className="mr-2 h-4 w-4" />
                )}
                Analyze Failure
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Analysis Result Section */}
      {aiLoading && (
        <Card>
          <CardHeader>
            <CardTitle>Analyzing...</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/4" />
          </CardContent>
        </Card>
      )}

      {aiError && <ErrorDisplay title="AI Analysis Error" message={aiError} />}

      {aiAnalysis && !aiLoading && (
        <Card className="border-primary bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <CheckCircle className="h-5 w-5" /> Analysis Complete
            </CardTitle>
            <CardDescription>
              Here's the analysis based on the provided details:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <Lightbulb className="h-4 w-4" />
              <AlertTitle>Identified Root Cause</AlertTitle>
              <AlertDescription>{aiAnalysis.rootCause}</AlertDescription>
            </Alert>
            <Alert>
              <Lightbulb className="h-4 w-4" />
              <AlertTitle>Suggested Fix</AlertTitle>
              <AlertDescription>
                <pre className="whitespace-pre-wrap font-mono text-xs bg-background p-2 rounded mt-1">
                  <code>{aiAnalysis.suggestedFix}</code>
                </pre>
              </AlertDescription>
            </Alert>
            <div>
              <strong className="text-sm">Confidence Level:</strong>
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
              <p className="text-xs text-muted-foreground mt-1">
                This indicates the AI's confidence in its analysis. Lower
                confidence may require more manual investigation.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
