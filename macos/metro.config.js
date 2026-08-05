const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const fs = require('node:fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const externalApps = process.env.UTOPIA_APPS_DIR
  ? path.resolve(process.cwd(), process.env.UTOPIA_APPS_DIR)
  : path.resolve(root, '../utopia-apps/packages');
const macModules = path.resolve(__dirname, 'node_modules');
const resolveMac = (name) => require.resolve(name, {paths: [macModules]});
const reactNativeMac = path.dirname(resolveMac('react-native-macos/package.json'));
const config = {
  watchFolders: [root, ...(fs.existsSync(externalApps) ? [externalApps] : [])],
  resolver: {
    useWatchman: false,
    nodeModulesPaths: [macModules, path.resolve(__dirname, '../node_modules')],
    resolveRequest(context, moduleName, platform) {
      if (moduleName === 'react' || moduleName.startsWith('react/')) {
        return context.resolveRequest(context, resolveMac(moduleName), platform);
      }
      if (moduleName === 'react-native' || moduleName.startsWith('react-native/')) {
        return context.resolveRequest(context, path.join(reactNativeMac, moduleName.slice('react-native'.length)), platform);
      }
      if (moduleName === 'react-native-svg' || moduleName.startsWith('react-native-svg/')) {
        return context.resolveRequest(context, resolveMac(moduleName), platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
    extraNodeModules: {
      react: path.join(macModules, 'react'),
      'react-native': reactNativeMac,
      'react-native-svg': path.resolve(__dirname, 'node_modules/react-native-svg'),
    },
    blockList: [new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/macos/macos/build/.*`)],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
