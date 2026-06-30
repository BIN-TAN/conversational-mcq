#!/bin/zsh
set -u

cd "/Users/binbin/Documents/Conversational MCQ" || exit 1

echo "Stopping Conversational MCQ local app..."
npm run app:local:stop
status=$?

echo
if [ "$status" -eq 0 ]; then
  echo "Stop command completed."
else
  echo "Stop command failed with status $status."
fi
echo "Press any key to close this window."
read -k 1
exit "$status"

