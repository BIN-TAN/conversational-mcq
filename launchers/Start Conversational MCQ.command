#!/bin/zsh
set -u

cd "/Users/binbin/Documents/Conversational MCQ" || exit 1

echo "Starting Conversational MCQ local app..."
npm run app:local:start
status=$?

echo
if [ "$status" -eq 0 ]; then
  echo "Startup command completed."
else
  echo "Startup command failed with status $status."
fi
echo "Press any key to close this window."
read -k 1
exit "$status"

