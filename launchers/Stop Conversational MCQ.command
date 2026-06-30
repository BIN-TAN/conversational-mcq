#!/bin/zsh
set -u

cd "/Users/binbin/Documents/Conversational MCQ" || exit 1

echo "Stopping Conversational MCQ local app..."
npm run app:local:stop
command_exit_code=$?

echo
if [ "$command_exit_code" -eq 0 ]; then
  echo "Stop command completed."
else
  echo "Stop command failed with status $command_exit_code."
fi
echo "Press any key to close this window."
read -k 1
exit "$command_exit_code"
