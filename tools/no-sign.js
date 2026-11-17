// electron-builder custom signer that signs nothing — used ONLY to produce an unsigned
// win-unpacked folder for local testing (the real, signed release goes through
// tools/release-windows.ps1). Usage:
//   npx electron-builder --win --dir --publish never -c.win.sign=tools/no-sign.js
exports.default = async function noSign() {};
