import React from "react";

/**
 * Last line of defence: a render error shows something actionable instead of a
 * blank screen, and the full stack is logged for a bug report.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[app error]", error, info && info.componentStack);
  }

  render() {
    if (this.state.error) {
      const detail =
        (this.state.error && (this.state.error.stack || this.state.error.message)) ||
        String(this.state.error);
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            overflow: "auto",
            padding: 20,
            background: "#08050a",
            color: "#fff6e4",
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            whiteSpace: "pre-wrap"
          }}
        >
          <h1 style={{ fontFamily: "system-ui, sans-serif", fontSize: 20, color: "#ff2d78" }}>
            Jersey Rhythm hit an error
          </h1>
          <p style={{ color: "#b8a9b6", marginBottom: 12 }}>
            Copy the text below when reporting it.
          </p>
          <div>{detail}</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: "10px 16px",
              borderRadius: 10,
              border: 0,
              background: "#ffc93c",
              color: "#1a0906",
              fontWeight: 900
            }}
          >
            RELOAD
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
