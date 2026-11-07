const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const esc = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// worker/ runs in Bare, not React Native. The app imports the packed copy (src/p2p/worker.bundle.js).
config.resolver.blockList = [
  new RegExp('^' + esc(path.join(__dirname, 'worker')) + '\\/.*'),
  new RegExp('^' + esc(path.join(__dirname, 'test')) + '\\/.*'),
]
module.exports = config
