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
  let fileContent = "";
  try {
    fileContent = fs.readFileSync(configPath, "utf-8");
  } catch (e) {
    // If we can't read the file, we can't parse or import it.
    return null;
  }

  // 1. Strategy: Text Parsing (Safe & Fast)
  // We try to read the file as text first. This finds the outputDir without
  // triggering any Node.js warnings or errors.
  try {
    // Regex matches: outputDir: "value" or outputDir: 'value'
    const match = fileContent.match(/outputDir:\s*["']([^"']+)["']/);

    if (match && match[1]) {
      return path.resolve(process.cwd(), match[1]);
    }
  } catch (e) {
    // Ignore text reading errors
  }

  // 2. Safety Check: Detect ESM in CJS to Prevent Node Warnings
  // The warning "To load an ES module..." happens when we try to import()
  // a .js file containing ESM syntax (import/export) in a CJS package.
  // We explicitly check for this and ABORT the import if found.
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
      // Heuristic: Check for ESM syntax (import/export at start of lines)
      const hasEsmSyntax =
        /^\s*import\s+/m.test(fileContent) ||
        /^\s*export\s+/m.test(fileContent);

      if (hasEsmSyntax) {
        // We found ESM syntax in a .js file within a CJS project.
        // Attempting to import this WILL trigger the Node.js warning.
        // Since regex failed to find outputDir, and we can't import safely, we abort now.
        return null;
      }
    }
  }

  // 3. Strategy: Dynamic Import
  // If we passed the safety check, we try to import the config.
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

      // Handle Default Export
      if (config && config.default) {
        config = config.default;
      }

      if (config) {
        // Check for Reporter Config
        if (config.reporter) {
          const reporters = Array.isArray(config.reporter)
            ? config.reporter
            : [config.reporter];

          for (const reporter of reporters) {
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
                return path.resolve(process.cwd(), reporterOptions.outputDir);
              }
            }
          }
        }

        // Check for Global outputDir
        if (config.outputDir) {
          return path.resolve(process.cwd(), config.outputDir);
        }
      }
    } finally {
      // Clean up globals
      global.__dirname = originalDirname;
      global.__filename = originalFilename;
    }
  } catch (error) {
    // SILENT CATCH: Do NOT log anything here.
    return null;
  }

  return null;
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
