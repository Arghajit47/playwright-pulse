#!/usr/bin/env node
import chalk from "chalk";

const logoRaw = `                :------------                
               --------------------            
     --      ------------------------          
------      ----------------                   
-----      -------------                       
------    -----------      ---------           
 ------- --------      ------   ---------      
   ------------- ----  ----  --- -----------   
     -----------  ---  ---- ----- ------------ 
        ----------   -------     --------------
           ----------------  -----------  -----
                 -----      -----------   -----
                         -------------   ------
             -------------------------------   
               --------------------            
                  --------------`;

/**
 * Plays the Pulse Logo animation.
 * Exported so it can be triggered by other scripts in your bin configuration.
 */
export async function animate() {
  // Just display the logo once without animation
  // Terminal clearing doesn't work reliably across all environments
  console.log(""); // Empty line for spacing
  console.log(
    logoRaw
      .split("\n")
      .map((line) => chalk.hex("#3f51b5")(line))
      .join("\n"),
  );
  console.log(
    chalk.white.bold("        P L A Y W R I G H T   P U L S E   R E P O R T"),
  );
  console.log(
    chalk.gray("     ──────────────────────────────────────────────────"),
  );
  console.log(""); // Empty line after logo
}

// Check if the script is being run directly (e.g., `pulse-logo`)
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("terminal-logo.mjs");

if (isDirectRun) {
  animate();
}
