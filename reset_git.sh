#!/bin/bash
cd "/Users/jeff/Library/Mobile Documents/com~apple~CloudDocs/Code/Meridian Takeoff"

# Remove rebase state
rm -rf .git/rebase-merge
rm -f .git/MERGE_MSG
rm -f .git/AUTO_MERGE

# Reset to the original commit before rebase
git reset --hard c1b39cb53bb005a76aab996c9ec0242dacaa7a2a

echo "Git state reset successfully"
