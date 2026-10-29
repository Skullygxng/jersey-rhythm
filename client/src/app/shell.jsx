import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const TABS = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/play", label: "Play", icon: "play" },
  { to: "/battle", label: "Battle", icon: "battle", soon: true },
  { to: "/leaderboards", label: "Boards", icon: "boards", soon: true },
  { to: "/profile", label: "You", icon: "profile" },
  { to: "/settings", label: "Setup", icon: "settings" }
];

function Icon({ name }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M4 11.5 12 4l8 7.5" />
          <path d="M6.5 10.5V20h11v-9.5" />
          <path d="M10 20v-5h4v5" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <path d="M8 5.5 18 12 8 18.5z" />
        </svg>
      );
    case "battle":
      return (
        <svg {...common}>
          <path d="M8 6l-4 6 4 6" />
          <path d="M16 6l4 6-4 6" />
        </svg>
      );
    case "boards":
      return (
        <svg {...common}>
          <path d="M5 20V10" />
          <path d="M12 20V5" />
          <path d="M19 20v-6" />
        </svg>
      );
    case "profile":
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.6" />
          <path d="M4.5 20c1.6-3.6 4.3-5.2 7.5-5.2s5.9 1.6 7.5 5.2" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
        </svg>
      );
    default:
      return null;
  }
}

function useCurrentPath() {
  const read = () => {
    const hash = window.location.hash || "";
    const raw = hash.replace(/^#/, "") || "/";
    const query = raw.indexOf("?");
    return query === -1 ? raw : raw.slice(0, query) || "/";
  };

  const [path, setPath] = useState(read);
  useEffect(() => {
    const onChange = () => setPath(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}

function isActive(path, to) {
  if (to === "/") return path === "/";
  return path === to || path.startsWith(to + "/");
}

export function Shell({ children }) {
  const path = useCurrentPath();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">JR</span>
          <span className="brand-text">
            <strong>JERSEY RHYTHM</strong>
            <em>BRICK CITY CLUB</em>
          </span>
        </Link>
        <span className="topbar-tag">VOL. 1</span>
      </header>

      <main className="shell-scroll">{children}</main>

      <nav className="tabbar">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className={"tab" + (isActive(path, tab.to) ? " is-active" : "")}
          >
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
            {tab.soon ? <em className="tab-soon">SOON</em> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
