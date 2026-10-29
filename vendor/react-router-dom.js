// Minimal HASH-based router implementing the exact react-router-dom surface
// this app uses (BrowserRouter, Routes, Route, Link, useNavigate,
// useParams, useSearchParams) on top of the vendored UMD React build.
// Hash routing is used because the web view may serve the app from any path.
const React = window.React;

const RouterContext = React.createContext(null);
const ParamsContext = React.createContext({});

function readLocation() {
  let hash = window.location.hash || "";
  if (hash && !hash.startsWith("#")) hash = "#" + hash;
  if (hash) {
    const raw = hash.slice(1) || "/";
    const queryIndex = raw.indexOf("?");
    return {
      path: queryIndex === -1 ? raw : raw.slice(0, queryIndex) || "/",
      search: queryIndex === -1 ? "" : raw.slice(queryIndex)
    };
  }
  // No hash yet: derive the path from the URL pathname (deep links), so
  // e.g. serving /gameplay/<song>/<diff> opens that page directly.
  let path = window.location.pathname || "/";
  path = path.replace(/index\.html$/, "");
  if (!path.startsWith("/")) path = "/" + path;
  return { path: path === "" ? "/" : path, search: window.location.search };
}

export function BrowserRouter({ children }) {
  const [state, setState] = React.useState(readLocation);

  React.useEffect(() => {
    const onHash = () => setState(readLocation());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = React.useCallback((to) => {
    const str = String(to || "/");
    window.location.hash = "#" + (str.startsWith("/") ? str : "/" + str);
  }, []);

  return React.createElement(
    RouterContext.Provider,
    { value: { ...state, navigate } },
    children
  );
}

export function useNavigate() {
  return React.useContext(RouterContext).navigate;
}

export function useSearchParams() {
  const { search } = React.useContext(RouterContext);
  return React.useMemo(() => [new URLSearchParams(search)], [search]);
}

function matchPath(pattern, path) {
  const patternParts = String(pattern).split("/").filter(Boolean);
  const pathParts = String(path).split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const part = patternParts[i];
    if (part.startsWith(":")) {
      try {
        params[part.slice(1)] = decodeURIComponent(pathParts[i]);
      } catch {
        params[part.slice(1)] = pathParts[i];
      }
    } else if (part !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function Routes({ children }) {
  const { path } = React.useContext(RouterContext);
  const routeChildren = React.Children.toArray(children);

  let homeRoute = null;
  for (const child of routeChildren) {
    const params = matchPath(child.props.path, path);
    if (params) {
      return React.createElement(
        ParamsContext.Provider,
        { value: params },
        child.props.element
      );
    }
    if (child.props.path === "/") homeRoute = child;
  }
  // Unknown path: land on home rather than a blank screen.
  if (homeRoute) {
    return React.createElement(
      ParamsContext.Provider,
      { value: {} },
      homeRoute.props.element
    );
  }
  return null;
}

export function Route() {
  return null;
}

export function useParams() {
  return React.useContext(ParamsContext);
}

export function Link(props) {
  const { navigate } = React.useContext(RouterContext);
  const { to, children, ...rest } = props;
  return React.createElement("a", {
    href: "#" + String(to),
    onClick: (event) => {
      event.preventDefault();
      navigate(to);
    },
    ...rest
  }, children);
}