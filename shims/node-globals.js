/* Injected into the browser bundle of the Circle web SDK so code written for
   Node finds the globals it expects. */
export { Buffer } from "buffer";
export { default as process } from "process/browser";
