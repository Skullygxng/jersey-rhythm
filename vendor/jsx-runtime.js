// Bridge module: implements the automatic JSX runtime API on top of the
// vendored UMD React build (used only if transformed code imports it).
const React = window.React;

export const Fragment = React.Fragment;

export function jsx(type, config, maybeKey) {
  let props = config || {};
  if (maybeKey !== undefined) props = { ...props, key: maybeKey };
  return React.createElement(type, props, props.children);
}

export const jsxs = jsx;

export default { Fragment, jsx, jsxs };