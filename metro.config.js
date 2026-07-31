const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

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
