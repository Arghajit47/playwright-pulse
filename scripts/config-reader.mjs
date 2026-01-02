#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { dirname } from "path";

const DEFAULT_OUTPUT_DIR = "pulse-report";

async function findPlaywrightConfig() {
  const possibleConfigs = [
    "playwright.config.ts",
    "playwright.config.js",
    "playwright.config.mjs",
  ];

  for (const configFile of possibleConfigs) {
    const configPath = path.resolve(process.cwd(), configFile);
    if (fs.existsSync(configPath)) {
      return { path: configPath, exists: true };
    }
  }

  return { path: null, exists: false };
}

async function extractOutputDirFromConfig(configPath) {
  try {
    let config;

    const configDir = dirname(configPath);
    // const originalDirname = global.__dirname; // Not strictly needed in ESM context usually, but keeping if you rely on it elsewhere
    // const originalFilename = global.__filename;

    // 1. Try Loading via Import (Existing Logic)
    try {
      if (configPath.endsWith(".ts")) {
        try {
          const { register } = await import("node:module");
          const { pathToFileURL } = await import("node:url");
          register("ts-node/esm", pathToFileURL("./"));
          config = await import(pathToFileURL(configPath).href);
        } catch (tsError) {
          const tsNode = await import("ts-node");
          tsNode.register({
            transpileOnly: true,
            compilerOptions: { module: "commonjs" },
          });
          config = require(configPath);
        }
      } else {
        // Try dynamic import for JS/MJS
        config = await import(pathToFileURL(configPath).href);
      }

      // Extract from default export or direct export
      if (config && config.default) {
        config = config.default;
      }

      if (config) {
        // Check specific reporter config
        if (config.reporter) {
          const reporters = Array.isArray(config.reporter)
            ? config.reporter
            : [config.reporter];

          for (const reporter of reporters) {
            // reporter can be ["list"] or ["html", { outputFolder: '...' }]
            const reporterName = Array.isArray(reporter)
              ? reporter[0]
              : reporter;
            const reporterOptions = Array.isArray(reporter)
              ? reporter[1]
              : null;

            if (
              typeof reporterName === "string" &&
              (reporterName.includes("playwright-pulse-report") ||
                reporterName.includes("@arghajit/playwright-pulse-report") ||
                reporterName.includes("@arghajit/dummy"))
            ) {
              if (reporterOptions && reporterOptions.outputDir) {
                // Found it via Import!
                return path.resolve(process.cwd(), reporterOptions.outputDir);
              }
            }
          }
        }

        // Check global outputDir
        if (config.outputDir) {
          return path.resolve(process.cwd(), config.outputDir);
        }
      }
    } catch (importError) {
      // Import failed (likely the SyntaxError you saw).
      // We suppress this error and fall through to the text-parsing fallback below.
    }

    // 2. Fallback: Parse file as text (New Logic)
    // This runs if import failed or if import worked but didn't have the specific config
    try {
      const fileContent = fs.readFileSync(configPath, "utf-8");

      // Regex to find: outputDir: "some/path" or 'some/path' inside the reporter config or global
      // This is a simple heuristic to avoid the "Cannot use import statement" error
      const match = fileContent.match(/outputDir:\s*["']([^"']+)["']/);

      if (match && match[1]) {
        console.log(`Found outputDir via text parsing: ${match[1]}`);
        return path.resolve(process.cwd(), match[1]);
      }
    } catch (readError) {
      // If reading fails, just return null silently
    }

    return null;
  } catch (error) {
    // Final safety net: Do not log the stack trace to avoid cluttering the console
    return null;
  }
}

export async function getOutputDir(customOutputDirFromArgs = null) {
  if (customOutputDirFromArgs) {
    console.log(`Using custom outputDir from CLI: ${customOutputDirFromArgs}`);
    return path.resolve(process.cwd(), customOutputDirFromArgs);
  }

  const { path: configPath, exists } = await findPlaywrightConfig();
  console.log(
    `Config file search result: ${exists ? configPath : "not found"}`
  );

  if (exists) {
    const outputDirFromConfig = await extractOutputDirFromConfig(configPath);
    if (outputDirFromConfig) {
      console.log(`Using outputDir from config: ${outputDirFromConfig}`);
      return outputDirFromConfig;
    }
  }

  console.log(`Using default outputDir: ${DEFAULT_OUTPUT_DIR}`);
  return path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
}
