#!/usr/bin/env bash

# Script to publish the build artifacts to a npm repository.
# Builds will be automatically published once new changes are made to the repository.

set -e -o pipefail

# Go to the project root directory
cd $(dirname $0)/..

# Create a release of the current module.
. $(dirname $0)/build.sh
echo "Start creating release of the current module"

# check for successful building
if [ $? -eq 0 ]; then
echo "Creating release of the current module success"
else
echo "Error is not recoverable: exiting now"
exit
fi

buildDir="dist/releases"
echo "npm publish ${buildDir} ${1} ${2}"
npm publish ${buildDir} $1 $2

echo "Finished publishing build artifacts to npm"
