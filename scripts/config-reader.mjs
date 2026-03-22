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

async function extractReporterOptionsFromConfig(configPath) {
  let fileContent = "";
  try {
    fileContent = fs.readFileSync(configPath, "utf-8");
  } catch (e) {
    return {};
  }

  const options = {};

  // 1. Strategy: Text Parsing (Safe & Fast)
  try {
    // Find the Pulse/Dummy reporter block
    // It usually looks like ["@arghajit/playwright-pulse-report", { ... }] or ["playwright-pulse-report", { ... }]
    const reporterBlockRegex = /\[\s*["'](?:@arghajit\/)?(?:playwright-pulse-report|dummy)["']\s*,\s*(\{[\s\S]*?\})\s*,?\s*\]/g;
    let match;
    while ((match = reporterBlockRegex.exec(fileContent)) !== null) {
      const block = match[1];
      
      const outputDirMatch = block.match(/outputDir:\s*["']([^"']+)["']/);
      if (outputDirMatch && outputDirMatch[1]) options.outputDir = outputDirMatch[1];

      const outputFileMatch = block.match(/outputFile:\s*["']([^"']+)["']/);
      if (outputFileMatch && outputFileMatch[1]) options.outputFile = outputFileMatch[1];

      const resetOnEachRunMatch = block.match(/resetOnEachRun:\s*(true|false)/);
      if (resetOnEachRunMatch) options.resetOnEachRun = resetOnEachRunMatch[1] === "true";

      const individualReportsSubDirMatch = block.match(/individualReportsSubDir:\s*["']([^"']+)["']/);
      if (individualReportsSubDirMatch && individualReportsSubDirMatch[1]) options.individualReportsSubDir = individualReportsSubDirMatch[1];
      
      // If we found any Pulse-specific options, we're likely in the right block
      if (Object.keys(options).length > 0) break;
    }

    // Fallback for global outputDir if not found in reporter block
    if (!options.outputDir) {
      const globalOutputDirMatch = fileContent.match(/outputDir:\s*["']([^"']+)["']/);
      if (globalOutputDirMatch && globalOutputDirMatch[1]) options.outputDir = globalOutputDirMatch[1];
    }
  } catch (e) { }

  // 2. Safety Check and Dynamic Import
  if (Object.keys(options).length < 3) {
    // Check if we can safely import()
    let canImport = true;
    if (configPath.endsWith(".js")) {
      let isModulePackage = false;
      try {
        const pkgPath = path.resolve(process.cwd(), "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          isModulePackage = pkg.type === "module";
        }
      } catch (e) {}

      if (!isModulePackage) {
        const hasEsmSyntax = /^\s*import\s+/m.test(fileContent) || /^\s*export\s+/m.test(fileContent);
        if (hasEsmSyntax) canImport = false;
      }
    }

    if (canImport) {
      try {
        let config;
        const configDir = dirname(configPath);
        const originalDirname = global.__dirname;
        const originalFilename = global.__filename;

        try {
          global.__dirname = configDir;
          global.__filename = configPath;

          if (configPath.endsWith(".ts")) {
            try {
              const { register } = await import("node:module");
              const { pathToFileURL } = await import("node:url");
              register("ts-node/esm", pathToFileURL("./"));
              config = await import(pathToFileURL(configPath).href);
            } catch (tsError) {
              const tsNode = await import("ts-node");
              tsNode.register({ transpileOnly: true, compilerOptions: { module: "commonjs" } });
              config = require(configPath);
            }
          } else {
            config = await import(pathToFileURL(configPath).href);
          }

          if (config && config.default) config = config.default;

          if (config) {
            if (config.reporter) {
              const reporters = Array.isArray(config.reporter) ? config.reporter : [config.reporter];
              for (const reporter of reporters) {
                const reporterName = Array.isArray(reporter) ? reporter[0] : reporter;
                const reporterOptions = Array.isArray(reporter) ? reporter[1] : null;

                if (typeof reporterName === "string" && 
                   (reporterName.includes("playwright-pulse-report") || 
                    reporterName.includes("@arghajit/playwright-pulse-report") ||
                    reporterName.includes("@arghajit/dummy"))) {
                  if (reporterOptions) {
                    if (reporterOptions.outputDir) options.outputDir = reporterOptions.outputDir;
                    if (reporterOptions.outputFile) options.outputFile = reporterOptions.outputFile;
                    if (reporterOptions.resetOnEachRun !== undefined) options.resetOnEachRun = reporterOptions.resetOnEachRun;
                    if (reporterOptions.individualReportsSubDir) options.individualReportsSubDir = reporterOptions.individualReportsSubDir;
                  }
                }
              }
            }
            if (config.outputDir && !options.outputDir) options.outputDir = config.outputDir;
          }
        } finally {
          global.__dirname = originalDirname;
          global.__filename = originalFilename;
        }
      } catch (error) {}
    }
  }

  return options;
}

export async function getReporterConfig(customOutputDirFromArgs = null) {
  const { path: configPath, exists } = await findPlaywrightConfig();
  let options = {};

  if (exists) {
    options = await extractReporterOptionsFromConfig(configPath);
  }

  const outputDir = customOutputDirFromArgs 
    ? path.resolve(process.cwd(), customOutputDirFromArgs)
    : path.resolve(process.cwd(), options.outputDir || DEFAULT_OUTPUT_DIR);

  const outputFile = options.outputFile || "playwright-pulse-report.json";
  const resetOnEachRun = options.resetOnEachRun !== undefined ? options.resetOnEachRun : true;
  const individualReportsSubDir = options.individualReportsSubDir || "pulse-results";

  return { outputDir, outputFile, resetOnEachRun, individualReportsSubDir };
}

export async function getOutputDir(customOutputDirFromArgs = null) {
  const config = await getReporterConfig(customOutputDirFromArgs);
  return config.outputDir;
}
