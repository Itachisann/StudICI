// Learn more https://docs.expo.dev/guides/customizing-metro
process.env.EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK = '1';

const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
