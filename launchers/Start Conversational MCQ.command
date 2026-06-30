#!/bin/zsh
set -u

cd "/Users/binbin/Documents/Conversational MCQ" || exit 1

echo "Starting Conversational MCQ local app..."
npm run app:local:start
command_exit_code=$?

echo
if [ "$command_exit_code" -eq 0 ]; then
  echo "Startup command completed."
else
  echo "Startup command failed with status $command_exit_code."
fi
echo "Press any key to close this window."
read -k 1
exit "$command_exit_code"
