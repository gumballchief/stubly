/* Empty stand-in for Node builtins when bundling the Circle web SDK for the
   browser. These modules are only reached by server-side JWT code paths the
   browser challenge flow never executes. If a runtime error ever points here,
   the assumption broke — bundle a real polyfill instead of widening this. */
module.exports = {};
