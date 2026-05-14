import sys
import os
from rich.console import Console
from rich.text import Text

# Initialize the Rich Console
console = Console()

LOGO_RAW = r"""                :------------                
                --------------------            
      --      ------------------------          
------      ----------------                    
-----      -------------                        
------      -----------         ---------            
 ------- --------      ------    ---------      
   ------------- ----    ----   --- -----------   
     -----------   ---    ---- ----- ------------ 
        ----------   -------     --------------
           ----------------   -----------   -----
                 -----       -----------   -----
                         -------------   ------
             -------------------------------   
               --------------------            
                  --------------"""

def animate():
    """
    Displays the Pulse Logo and title using Rich for terminal styling.
    """
    console.print("")  # Empty line for spacing
    
    # Split the logo and apply the Indigo hex color to each line
    lines = LOGO_RAW.split("\n")
    for line in lines:
        # Using #3f51b5 to match your original Indigo chalk hex
        console.print(line, style="#3f51b5")

    # Display Bold Title
    console.print("        [bold white]P L A Y W R I G H T   P U L S E   R E P O R T[/bold white]")
    
    # Display the Gray horizontal separator
    console.print("      [grey50]──────────────────────────────────────────────────[/grey50]")
    
    console.print("")  # Empty line after logo

if __name__ == "__main__":
    # In Python, we check __name__ to see if the script is run directly
    animate()