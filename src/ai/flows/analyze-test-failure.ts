'use server';

/**
 * @fileOverview An AI agent for analyzing test failures, identifying root causes, and suggesting fixes.
 *
 * - analyzeTestFailure - A function that handles the test failure analysis process.
 * - AnalyzeTestFailureInput - The input type for the analyzeTestFailure function.
 * - AnalyzeTestFailureOutput - The return type for the analyzeTestFailure function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';

const AnalyzeTestFailureInputSchema = z.object({
  testName: z.string().describe('The name of the test that failed.'),
  testResult: z.string().describe('The detailed result of the failed test, including logs and error messages.'),
  codeSnippet: z.string().describe('The relevant code snippet from the test file.'),
});
export type AnalyzeTestFailureInput = z.infer<typeof AnalyzeTestFailureInputSchema>;

const AnalyzeTestFailureOutputSchema = z.object({
  rootCause: z.string().describe('The identified root cause of the test failure.'),
  suggestedFix: z.string().describe('A suggestion for fixing the test failure.'),
  confidenceLevel: z.number().describe('A confidence level (0-1) indicating the certainty of the analysis.'),
});
export type AnalyzeTestFailureOutput = z.infer<typeof AnalyzeTestFailureOutputSchema>;

export async function analyzeTestFailure(input: AnalyzeTestFailureInput): Promise<AnalyzeTestFailureOutput> {
  return analyzeTestFailureFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeTestFailurePrompt',
  input: {
    schema: z.object({
      testName: z.string().describe('The name of the test that failed.'),
      testResult: z.string().describe('The detailed result of the failed test, including logs and error messages.'),
      codeSnippet: z.string().describe('The relevant code snippet from the test file.'),
    }),
  },
  output: {
    schema: z.object({
      rootCause: z.string().describe('The identified root cause of the test failure.'),
      suggestedFix: z.string().describe('A suggestion for fixing the test failure.'),
      confidenceLevel: z.number().describe('A confidence level (0-1) indicating the certainty of the analysis.'),
    }),
  },
  prompt: `You are an AI assistant that analyzes failed tests to identify the root cause and suggest potential fixes.

  Test Name: {{{testName}}}
  Test Result: {{{testResult}}}
  Code Snippet: {{{codeSnippet}}}

  Based on the above information, provide the root cause of the failure, a suggested fix, and a confidence level (0-1) for your analysis.
  `,
});

const analyzeTestFailureFlow = ai.defineFlow<
  typeof AnalyzeTestFailureInputSchema,
  typeof AnalyzeTestFailureOutputSchema
>({
  name: 'analyzeTestFailureFlow',
  inputSchema: AnalyzeTestFailureInputSchema,
  outputSchema: AnalyzeTestFailureOutputSchema,
},
async input => {
  const {output} = await prompt(input);
  return output!;
});
