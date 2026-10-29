// Bridge module: exposes the vendored UMD React build as an ES module.
const React = window.React;

export default React;
export const useState = React.useState;
export const useEffect = React.useEffect;
export const useRef = React.useRef;
export const useMemo = React.useMemo;
export const useCallback = React.useCallback;
export const useReducer = React.useReducer;
export const useContext = React.useContext;
export const useLayoutEffect = React.useLayoutEffect;
export const useId = React.useId;