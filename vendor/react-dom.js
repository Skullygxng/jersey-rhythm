// Bridge module: exposes the vendored UMD ReactDOM build as an ES module.
const ReactDOM = window.ReactDOM;

export default {
  createRoot: ReactDOM.createRoot
};