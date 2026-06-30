#!/bin/zsh
set -u

cd "/Users/binbin/Documents/Conversational MCQ" || exit 1

echo "Checking Conversational MCQ local app status..."
npm run app:local:status
command_exit_code=$?

echo
if [ "$command_exit_code" -eq 0 ]; then
  echo "Status command completed."
else
  echo "Status command failed with status $command_exit_code."
fi
echo "Press any key to close this window."
read -k 1
exit "$command_exit_code"
