#!/usr/bin/env bash

set -e -o pipefail

# Go to the project root directory
cd $(dirname $0)/..

#clear dist folder
rm -rf dist

sourceDir="src/lib"
buildDir="dist/releases"
declarationDir="dist/out-tsc/src/lib"
############################################## Start create dist folder ################################################
echo "Creating $buildDir"

mkdir -p ${buildDir}
#clean previously build code
rm -rf ${buildDir}/*

#check for successful dir creation
if [ $? -eq 0 ]; then
echo "Create $buildDir is successful"
else
echo "Error is not recoverable: exiting now"
exit
fi
############################################## End create dist folder ##################################################
############################################## Start npm build #########################################################
#compiling typescript
echo 'Start compiling typescript'
npm run build:tsc
#check for successful dir creation
if [ $? -eq 0 ]; then
echo "Create $buildDir is successful"
else
echo "Error is not recoverable: exiting now"
exit
fi
############################################## End npm build ###########################################################

#copy package json
cp  ${sourceDir}/package.json ${buildDir}

echo 'Start copying typescript files'
rsync -r ${sourceDir}/* ${buildDir} --exclude="*.spec.ts"

echo 'Start copying declaration files'
rsync -r ${declarationDir}/* ${buildDir}  --include="*/" --include="*.d.ts" --exclude="*"

rm -f ${buildDir}/public_api.* ${buildDir}/tsconfig-build.json ${buildDir}/tsconfig-tests.json ${buildDir}/typings.d.ts