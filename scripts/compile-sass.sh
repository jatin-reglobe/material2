#!/usr/bin/env bash

set -e -o pipefail

# Go to the project root directory
cd $(dirname $0)/..

FILES=$(find dist/releases -type f -name '*.scss')
for f in $FILES
do
  echo "Processing $f file..."
  filename="${f##*/}"
  extension="${f##*.}"
  filenameWithoutExt="${f%.*}"
  if [[ ${filename} != *"_"* ]]; then
    echo "It's there!"
    $(npm bin)/node-sass ${f} ${filenameWithoutExt}.css --include-path ./dist/releases
  fi
done