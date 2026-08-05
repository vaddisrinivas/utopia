const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const externalAppsDir = process.env.UTOPIA_APPS_DIR
  ? path.resolve(process.cwd(), process.env.UTOPIA_APPS_DIR)
  : path.resolve(__dirname, '../utopia-apps/packages');
const canonicalExternalAppsDir = path.normalize(externalAppsDir);

if (fs.existsSync(canonicalExternalAppsDir)) {
  config.watchFolders = [...(config.watchFolders || []), canonicalExternalAppsDir];
}

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (process.env.UTOPIA_RELEASE_BUNDLE === '1' && moduleName.endsWith('DevelopmentGoldenLoopBridge')) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/quality/ReleaseNoopGoldenLoopBridge.tsx'),
    };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
